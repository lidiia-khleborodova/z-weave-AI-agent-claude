import 'dotenv/config';
import express, { Request, Response } from 'express';
import { fetchAllArticles } from './zendesk';
import { searchArticles } from './search';
import { askAgent } from './agent';
import { loadPatterns, searchPatterns, isPatternQuery, formatPatternResults } from './patterns';
import { ParsedArticle } from './types';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const REFRESH_INTERVAL_MS = 21_600_000; // 6 hours in milliseconds

let articles: ParsedArticle[] = [];

async function refreshArticles(): Promise<void> {
  console.log('Refreshing articles from Zendesk...');
  try {
    articles = await fetchAllArticles();
    console.log(`Refresh complete. ${articles.length} articles loaded.`);
  } catch (err) {
    console.error('Failed to refresh articles:', err);
  }
}

app.post('/chat', async (req: Request, res: Response) => {
  const { question } = req.body as { question?: string };

  if (!question || typeof question !== 'string' || question.trim() === '') {
    res.status(400).json({ error: 'question is required' });
    return;
  }

  const q = question.trim();

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  // Pattern search — handle before calling Claude
  if (isPatternQuery(q)) {
    const results = searchPatterns(q);
    res.write(formatPatternResults(results));
    res.end();
    return;
  }

  try {
    const relevant = searchArticles(q, articles);
    for await (const chunk of askAgent(q, relevant)) {
      res.write(chunk);
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

  loadPatterns();
  articles = await fetchAllArticles();
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
