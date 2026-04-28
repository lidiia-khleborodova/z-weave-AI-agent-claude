import { embed, cosineSimilarity } from './embeddings';
import { ParsedArticle } from './types';

interface EmbeddedArticle {
  article: ParsedArticle;
  embedding: number[];
}

let embeddedArticles: EmbeddedArticle[] = [];

export async function buildEmbeddingIndex(articles: ParsedArticle[]): Promise<void> {
  console.log(`Building embeddings for ${articles.length} articles...`);
  embeddedArticles = await Promise.all(
    articles.map(async (article) => {
      const articleEmbedding = await embed(`${article.title}\n\n${article.body}`);
      const images = await Promise.all(
        article.images.map(async (img) => ({
          ...img,
          embedding: await embed(`${article.title}: ${img.alt}`),
        }))
      );
      return { article: { ...article, images }, embedding: articleEmbedding };
    })
  );
  console.log('Embedding index ready.');
}

export function getAllArticles(): ParsedArticle[] {
  return embeddedArticles.map((e) => e.article);
}

export async function searchArticles(query: string, topN = 3): Promise<ParsedArticle[]> {
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
