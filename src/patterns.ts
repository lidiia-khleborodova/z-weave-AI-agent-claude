import { embed, cosineSimilarity } from './embeddings';
import { Asset, EmbeddedAsset } from './types';

const ASSET_API_URL = 'https://api.z-emotion.com/prod/v2/assets/take?limit=500&skip=0';
const REFRESH_INTERVAL_MS = 21600000; // 6 hours

let embeddedAssets: EmbeddedAsset[] = [];

interface RawAsset {
  assetId?: string;
  id?: string;
  _id?: string;
  assetName?: string;
  name?: string;
  title?: string;
  category?: string;
  category_sub?: string;
  category_sub_sub?: string;
  gender?: string;
  color?: string[];
  texture?: string;
  physics?: string;
  composition?: { label: string; value: string; amount: string }[];
  file_type?: string[];
  url_thumbnail?: string[];
  url_asset?: string[];
}

function mapRawAsset(r: RawAsset): Asset {
  const category = r.category ?? 'garment';
  const styleType = [r.category_sub, r.category_sub_sub].filter(Boolean).join(' > ');
  const color = Array.isArray(r.color) ? r.color : [];
  const composition = r.composition?.map((c) => `${c.label} ${c.amount}%`).join(', ') ?? '';
  const fileType = r.file_type?.[0] ?? (category === 'fabric' ? 'u3ma' : 'zls');

  return {
    assetId: r.assetId ?? r.id ?? r._id ?? '',
    name: r.assetName ?? r.name ?? r.title ?? 'Unknown',
    category,
    styleType,
    gender: r.gender ?? '',
    color,
    texture: r.texture ?? '',
    composition,
    fileType,
    previewUrl: r.url_thumbnail?.[0] ?? '',
    downloadUrl: r.url_asset?.[0] ?? '',
  };
}

function assetEmbedText(a: Asset): string {
  const parts = [a.name, a.category, a.styleType, a.gender];
  if (a.color.length > 0) parts.push(a.color.join(' '), a.color.join(' ')); // repeat for weight
  if (a.texture) parts.push(a.texture);
  if (a.composition) parts.push(a.composition, a.composition, a.composition); // repeat composition heavily
  return parts.filter(Boolean).join(' ');
}

async function fetchAssets(): Promise<Asset[]> {
  const response = await fetch(ASSET_API_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://z-emotion.com/',
    },
  });

  if (!response.ok) throw new Error(`Asset API HTTP ${response.status}`);

  const data = await response.json() as Record<string, unknown>;

  let raw: RawAsset[] = [];
  if (Array.isArray(data)) {
    raw = data as RawAsset[];
  } else {
    const search = (obj: Record<string, unknown>, depth = 0): RawAsset[] | null => {
      if (depth > 2) return null;
      for (const key of ['assets', 'items', 'list', 'results', 'content', 'data']) {
        if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0) return obj[key] as RawAsset[];
      }
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const found = search(val as Record<string, unknown>, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };
    raw = search(data) ?? [];
  }

  return raw.map(mapRawAsset);
}

async function buildAssetEmbeddings(assets: Asset[]): Promise<void> {
  embeddedAssets = await Promise.all(
    assets.map(async (asset) => ({
      asset,
      embedding: await embed(assetEmbedText(asset)),
    }))
  );
}

export async function loadAssets(): Promise<void> {
  console.log('Fetching assets from Z-Emotion API...');
  const assets = await fetchAssets();
  console.log(`Fetched ${assets.length} assets. Building embeddings...`);
  await buildAssetEmbeddings(assets);
  console.log('Asset embeddings ready.');

  setInterval(async () => {
    console.log('Refreshing asset library...');
    try {
      const refreshed = await fetchAssets();
      await buildAssetEmbeddings(refreshed);
      console.log(`Asset library refreshed. ${refreshed.length} assets loaded.`);
    } catch (err) {
      console.error('Failed to refresh assets:', err);
    }
  }, REFRESH_INTERVAL_MS);
}

export async function searchAssets(query: string, threshold = 0.5): Promise<Asset[]> {
  if (embeddedAssets.length === 0) return [];
  const queryLower = query.toLowerCase();
  const queryEmbedding = await embed(query);

  const MATERIALS = ['cotton','polyester','silk','wool','linen','nylon','rayon','spandex','lycra','denim','leather','velvet','satin','chiffon','modal','bamboo','viscose','acrylic','cashmere','hemp'];

  const mentionedMaterial = MATERIALS.find((m) => queryLower.includes(m));

  const scored = embeddedAssets.map(({ asset, embedding }) => {
    let score = cosineSimilarity(queryEmbedding, embedding);
    const colorMatch = asset.color.length > 0 && asset.color.some(
      (c) => queryLower.includes(c.toLowerCase()) || c.toLowerCase().includes(queryLower.split(' ')[0])
    );
    if (colorMatch) score += 0.1;
    return { asset, score, colorMatch };
  });

  const queryMentionsColor = scored.some((s) => s.colorMatch);

  return scored
    .filter((s) => {
      if (s.score < threshold) return false;
      // if query mentions a material, require it to appear in composition
      if (mentionedMaterial && s.asset.composition) {
        if (!s.asset.composition.toLowerCase().includes(mentionedMaterial)) return false;
      }
      // if query mentions a color, require color match for color-tagged assets
      if (queryMentionsColor && s.asset.color.length > 0) return s.colorMatch;
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.asset);
}

export function formatAssetResults(assets: Asset[]): string {
  if (assets.length === 0) {
    return "I couldn't find any assets matching your request. Try searching with different keywords.";
  }
  return `ASSET_RESULTS:${JSON.stringify(assets)}`;
}
