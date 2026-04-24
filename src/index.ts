import 'dotenv/config';
import { franc } from 'franc-min';
import * as path from 'path';
import * as crypto from 'crypto';
import express, { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fetchAllArticles } from './zendesk';
import { buildEmbeddingIndex, buildIntentEmbeddings, detectIntent, searchArticles, getRelevantImages, getAllArticles } from './search';
import { askAgent, translateToEnglish } from './agent';
import { loadPatterns, searchPatterns, formatPatternResults } from './patterns';
import { ParsedArticle } from './types';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const REFRESH_INTERVAL_MS = 21600000; // 6 hours
const HISTORY_WINDOW = 4; // last 4 messages = 2 exchanges
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

let articles: ParsedArticle[] = [];

interface Session {
  history: Anthropic.MessageParam[];
  lastActive: number;
}
const sessions = new Map<string, Session>();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL_MS) sessions.delete(id);
  }
}, 5 * 60 * 1000);

async function refreshArticles(): Promise<void> {
  console.log('Refreshing articles from Zendesk...');
  try {
    articles = await fetchAllArticles();
    await buildEmbeddingIndex(articles);
    console.log(`Refresh complete. ${articles.length} articles loaded.`);
  } catch (err) {
    console.error('Failed to refresh articles:', err);
  }
}

app.post('/chat', async (req: Request, res: Response) => {
  const { question, sessionId: incomingSessionId } = req.body as { question?: string; sessionId?: string };

  if (!question || typeof question !== 'string' || question.trim() === '') {
    res.status(400).json({ error: 'question is required' });
    return;
  }

  const q = question.trim();
  const sessionId = incomingSessionId ?? crypto.randomUUID();
  const session = sessions.get(sessionId) ?? { history: [], lastActive: Date.now() };

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Session-Id', sessionId);
  res.setHeader('Access-Control-Expose-Headers', 'X-Session-Id');

  const intent = await detectIntent(q);

  if (intent === 'pattern') {
    const results = await searchPatterns(q);
    res.write(formatPatternResults(results));
    res.end();
    return;
  }

  try {
    const lang = franc(q);
    const englishQ = (lang === 'eng' || lang === 'und') ? q : await translateToEnglish(q);

    const APPS = ['z-weave', 'z-maya', 'z-unreal'];
    const mentionedApp = APPS.find((app) => englishQ.toLowerCase().includes(app));

    const isVersionQuery = /version|release|update|latest|newest|changelog/i.test(englishQ);

    let relevant: ParsedArticle[] = [];
    if (intent === 'general' && !mentionedApp) {
      // skip article retrieval — Claude will use web search if needed
    } else if (isVersionQuery && mentionedApp) {
      const parseVersion = (title: string): number[] => {
        const match = title.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
        return match ? [+match[1], +match[2], +(match[3] ?? 0)] : [-1, -1, -1];
      };
      const compareVersions = (a: number[], b: number[]): number => {
        for (let i = 0; i < 3; i++) if (b[i] !== a[i]) return b[i] - a[i];
        return 0;
      };
      const allAppArticles = getAllArticles()
        .filter((a) => a.section.toLowerCase().includes(mentionedApp));
      const versionArticles = allAppArticles
        .filter((a) => /^\d+\.\d+/.test(a.title))
        .sort((a, b) => compareVersions(parseVersion(a.title), parseVersion(b.title)));
      console.log('[version sort]', versionArticles.slice(0, 5).map((a) => `"${a.title}"`).join(', '));
      relevant = versionArticles.length > 0 ? versionArticles.slice(0, 3) : allAppArticles.slice(0, 3);
    } else {
      relevant = await searchArticles(englishQ, mentionedApp ? 30 : 5);
      if (mentionedApp) {
        const filtered = relevant.filter((a) => a.section.toLowerCase().includes(mentionedApp));
        if (filtered.length > 0) {
          const manuals = filtered.filter((a) => !a.section.toLowerCase().includes('faq'));
          const faqs = filtered.filter((a) => a.section.toLowerCase().includes('faq'));
          relevant = [...manuals, ...faqs].slice(0, 5);
        } else {
          relevant = relevant.slice(0, 5);
        }
      }
    }

    console.log('[retrieved articles]', relevant.map((a) => `"${a.title}" (${a.section})`).join(', '));
    const images = await getRelevantImages(englishQ, relevant);
    const history = session.history.slice(-HISTORY_WINDOW);

    let assistantMessage: Anthropic.MessageParam | undefined;
    for await (const event of askAgent(q, relevant, history, images)) {
      if (event.chunk) res.write(event.chunk);
      if (event.assistantMessage) assistantMessage = event.assistantMessage;
    }

    if (assistantMessage) {
      session.history = [...history, { role: 'user' as const, content: q }, assistantMessage].slice(-HISTORY_WINDOW);
      session.lastActive = Date.now();
      sessions.set(sessionId, session);
    }

    res.end();
  } catch (err) {
    console.error('Agent error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.end();
    }
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', articles: articles.length });
});

async function main() {
  console.log('Starting Help Center Agent...');

  articles = await fetchAllArticles();
  await Promise.all([buildEmbeddingIndex(articles), buildIntentEmbeddings(), loadPatterns()]);
  console.log(`Ready with ${articles.length} help center articles.`);

  setInterval(refreshArticles, REFRESH_INTERVAL_MS);
  console.log(`Articles will refresh every ${REFRESH_INTERVAL_MS / 3600000} hours.`);

  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
