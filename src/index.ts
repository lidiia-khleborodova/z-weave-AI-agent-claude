import 'dotenv/config';
import * as path from 'path';
import * as crypto from 'crypto';
import express, { Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { fetchAllArticles } from './zendesk';
import { buildEmbeddingIndex } from './search';
import { askAgent } from './agent';
import { loadPatterns } from './patterns';
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

  try {
    const history = session.history.slice(-HISTORY_WINDOW);

    let assistantMessage: Anthropic.MessageParam | undefined;
    for await (const event of askAgent(q, history)) {
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
  await Promise.all([buildEmbeddingIndex(articles), loadPatterns()]);
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
