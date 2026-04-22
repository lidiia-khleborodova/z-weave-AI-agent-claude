import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { embed, cosineSimilarity } from './embeddings';
import { Pattern, EmbeddedPattern } from './types';

const CSV_PATH = path.join(__dirname, '..', 'data', 'zls links sample.csv');

let embeddedPatterns: EmbeddedPattern[] = [];

export async function loadPatterns(): Promise<void> {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8').replace(/^\uFEFF/, '');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const patterns: Pattern[] = rows.map((r) => ({
    name: r['Name'] ?? '',
    link: r['Link'] ?? '',
    gender: r['Gender'] ?? '',
    type: r['Type'] ?? '',
  }));

  console.log(`Loaded ${patterns.length} patterns. Building pattern embeddings...`);
  embeddedPatterns = await Promise.all(
    patterns.map(async (pattern) => ({
      pattern,
      embedding: await embed(`${pattern.name} ${pattern.gender} ${pattern.type}`),
    }))
  );
  console.log('Pattern embeddings ready.');
}

export async function searchPatterns(query: string, topN = 5, threshold = 0.38): Promise<Pattern[]> {
  if (embeddedPatterns.length === 0) return [];
  const queryEmbedding = await embed(query);
  const scored = embeddedPatterns.map(({ pattern, embedding }) => ({
    pattern,
    score: cosineSimilarity(queryEmbedding, embedding),
  }));
  console.log('[pattern scores]', scored.sort((a, b) => b.score - a.score).slice(0, 5).map((s) => `"${s.pattern.name}": ${s.score.toFixed(3)}`).join(', '));
  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => s.pattern);
}

export function formatPatternResults(results: Pattern[]): string {
  if (results.length === 0) {
    return "I couldn't find any patterns matching your request in the asset library. Try searching with different keywords (e.g. gender, item type).";
  }

  const lines = results.map((p) => `- **${p.name}** (${p.gender}, ${p.type}): [Download](${p.link})`);
  return `Here are the matching patterns from the asset library:\n\n${lines.join('\n')}`;
}
