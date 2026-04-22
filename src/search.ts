import { embed, cosineSimilarity } from './embeddings';
import { ParsedArticle } from './types';

interface EmbeddedArticle {
  article: ParsedArticle;
  embedding: number[];
}

let embeddedArticles: EmbeddedArticle[] = [];

const PATTERN_INTENT_PHRASES = [
  'download a sewing pattern from the asset library',
  'find a ZLS pattern template to download',
  'browse and download clothing patterns',
  'get a downloadable shirt pants jacket pattern file',
  'show me patterns available in the asset library',
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
  console.log(`[intent scores] pattern: ${patternScore.toFixed(3)}, tutorial: ${tutorialScore.toFixed(3)}`);

  if (tutorialScore > 0.4 && tutorialScore >= patternScore) return 'tutorial';
  if (patternScore > 0.5) return 'pattern';
  return 'general';
}

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

export async function getRelevantImages(
  query: string,
  articles: ParsedArticle[],
  topN = 6,
  threshold = 0.28
): Promise<{ alt: string; src: string }[]> {
  const queryEmbedding = await embed(query);
  const candidates = articles
    .flatMap((a) => a.images.filter((img) => img.embedding))
    .filter((img) => !/^Screenshot\s[\d\-. ]+\.png$/i.test(img.alt)); // skip filename-only alts
  const scored = candidates.map((img) => ({ img, score: cosineSimilarity(queryEmbedding, img.embedding!) }));
  console.log('[image scores]', scored.map((s) => `"${s.img.alt}": ${s.score.toFixed(3)}`).join(', '));
  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => ({ alt: s.img.alt, src: s.img.src }));
}

export function getAllArticles(): ParsedArticle[] {
  return embeddedArticles.map((e) => e.article);
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
