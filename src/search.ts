import { embed, cosineSimilarity } from './embeddings';
import { ParsedArticle } from './types';

interface EmbeddedArticle {
  article: ParsedArticle;
  embedding: number[];
}

let embeddedArticles: EmbeddedArticle[] = [];

const PATTERN_INTENT_PHRASES = [
  'download a sewing pattern',
  'find a pattern template in the asset library',
  'get a clothing pattern file',
  'browse pattern assets',
  'download shirt pants jacket pattern',
];

const TUTORIAL_INTENT_PHRASES = [
  'show me a video tutorial',
  'how to make this step by step',
  'watch a guide on how to do this',
  'learn with a video demo',
  'tutorial for creating clothing',
];

let patternIntentEmbeddings: number[][] = [];
let tutorialIntentEmbeddings: number[][] = [];

export async function buildIntentEmbeddings(): Promise<void> {
  [patternIntentEmbeddings, tutorialIntentEmbeddings] = await Promise.all([
    Promise.all(PATTERN_INTENT_PHRASES.map(embed)),
    Promise.all(TUTORIAL_INTENT_PHRASES.map(embed)),
  ]);
  console.log('Intent embeddings ready.');
}

function maxSimilarity(queryEmbedding: number[], references: number[][]): number {
  return Math.max(...references.map((ref) => cosineSimilarity(queryEmbedding, ref)));
}

export async function detectIntent(query: string): Promise<'pattern' | 'tutorial' | 'general'> {
  const queryEmbedding = await embed(query);
  const patternScore = maxSimilarity(queryEmbedding, patternIntentEmbeddings);
  const tutorialScore = maxSimilarity(queryEmbedding, tutorialIntentEmbeddings);

  if (tutorialScore > 0.4 && tutorialScore >= patternScore) return 'tutorial';
  if (patternScore > 0.4) return 'pattern';
  return 'general';
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
