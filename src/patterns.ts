import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const CSV_PATH = path.join(__dirname, '..', 'data', 'zls links sample.csv');

interface Pattern {
  name: string;
  link: string;
  gender: string;
  type: string;
}

let patterns: Pattern[] = [];

export function loadPatterns(): void {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  patterns = rows.map((r) => ({
    name: r['Name'] ?? '',
    link: r['Link'] ?? '',
    gender: r['Gender'] ?? '',
    type: r['Type'] ?? '',
  }));
  console.log(`Loaded ${patterns.length} patterns from CSV.`);
}

const TYPE_ALIASES: Record<string, string[]> = {
  pants: ['pants', 'trousers', 'jeans', 'chinos', 'shorts'],
  shorts: ['shorts'],
  skirt: ['skirt'],
  jacket: ['jacket', 'blazer', 'coat', 'parka', 'vest'],
  shirt: ['shirt', 'blouse', 'top'],
  jumpsuit: ['jumpsuit', 'overall', 'overalls'],
  coat: ['coat', 'parka', 'outerwear'],
  vest: ['vest'],
};

const GENDER_KEYWORDS: Record<string, string> = {
  men: 'Men',
  man: 'Men',
  male: 'Men',
  boys: 'Men',
  women: 'Women',
  woman: 'Women',
  female: 'Women',
  girls: 'Women',
  ladies: 'Women',
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
}

export function searchPatterns(query: string): Pattern[] {
  const q = normalize(query);
  const words = q.split(/\s+/);

  // Detect gender from query
  let genderFilter: string | null = null;
  for (const word of words) {
    if (GENDER_KEYWORDS[word]) {
      genderFilter = GENDER_KEYWORDS[word];
      break;
    }
  }

  // Detect type from query
  let typeFilter: string | null = null;
  for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.some((alias) => q.includes(alias))) {
      typeFilter = type;
      break;
    }
  }

  return patterns.filter((p) => {
    const pName = normalize(p.name);
    const pType = normalize(p.type);
    const pGender = p.gender;

    // Gender must match if detected
    if (genderFilter && pGender !== genderFilter) return false;

    // Type must match if detected
    if (typeFilter) {
      const aliases = TYPE_ALIASES[typeFilter] ?? [typeFilter];
      if (!aliases.some((a) => pType.includes(a))) return false;
    }

    // If no type/gender filter detected, fall back to name keyword match
    if (!typeFilter && !genderFilter) {
      return words.some((w) => w.length > 2 && pName.includes(w));
    }

    return true;
  });
}

export function isPatternQuery(question: string): boolean {
  const q = normalize(question);
  const patternKeywords = [
    'pattern', 'template', 'download', 'asset', 'file', 'zls',
    'skirt', 'pants', 'trousers', 'jacket', 'shirt', 'shorts',
    'coat', 'vest', 'jumpsuit', 'blouse', 'parka',
  ];
  return patternKeywords.some((kw) => q.includes(kw));
}

export function formatPatternResults(results: Pattern[]): string {
  if (results.length === 0) {
    return "I couldn't find any patterns matching your request in the asset library. Try searching with different keywords (e.g. gender, item type).";
  }

  const lines = results.map((p) => `- **${p.name}** (${p.gender}, ${p.type}): [Download](${p.link})`);
  return `Here are the matching patterns from the asset library:\n\n${lines.join('\n')}`;
}
