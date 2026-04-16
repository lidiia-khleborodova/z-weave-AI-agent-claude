import OpenAI from 'openai';
import { ParsedArticle } from './types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

interface EmbeddedArticle {
  article: ParsedArticle;
  embedding: number[];
}

let embeddedArticles: EmbeddedArticle[] = [];

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.slice(0, 8000),
  });
  return res.data[0].embedding;
}

export async function buildEmbeddingIndex(articles: ParsedArticle[]): Promise<void> {
  console.log(`Building embeddings for ${articles.length} articles...`);
  embeddedArticles = await Promise.all(
    articles.map(async (article) => ({
      article,
      embedding: await embed(`${article.title}\n\n${article.body}`),
    }))
  );
  console.log('Embedding index ready.');
}

export async function searchArticles(
  query: string,
  topN = 5
): Promise<ParsedArticle[]> {
  if (embeddedArticles.length === 0) return [];
  const queryEmbedding = await embed(query);
  return embeddedArticles
    .map(({ article, embedding }) => ({
      article,
      score: cosineSimilarity(queryEmbedding, embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => s.article);
}
