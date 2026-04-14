import { ParsedArticle } from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'in', 'on', 'at', 'to', 'for',
  'of', 'and', 'or', 'but', 'not', 'with', 'this', 'that', 'how',
  'do', 'i', 'my', 'can', 'what', 'when', 'where', 'why', 'who',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

export function searchArticles(
  query: string,
  articles: ParsedArticle[],
  topN = 5
): ParsedArticle[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored = articles.map((article) => {
    const titleTokens = tokenize(article.title);
    const bodyTokens = tokenize(article.body);

    let score = 0;
    for (const token of queryTokens) {
      // Title matches are worth more
      const titleMatches = titleTokens.filter((t) => t.includes(token)).length;
      const bodyMatches = bodyTokens.filter((t) => t.includes(token)).length;
      score += titleMatches * 3 + bodyMatches;
    }

    return { article, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => s.article);
}
