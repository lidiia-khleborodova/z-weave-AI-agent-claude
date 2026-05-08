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
  category_sub?: string;
  category_sub_sub?: string;
  styleType?: string;
  category?: string;
  gender?: string;
  url_thumbnail?: string[];
  previewUrl?: string;
  thumbnailUrl?: string;
  url_asset?: string[];
  downloadUrl?: string;
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
      for (const key of ['assets', 'items', 'list', 'results', 'content']) {
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

  return raw.map((r) => ({
    assetId: r.assetId ?? r.id ?? r._id ?? '',
    name: r.assetName ?? r.name ?? r.title ?? 'Unknown',
    styleType: [r.category_sub, r.category_sub_sub].filter(Boolean).join(' > ') || r.styleType || r.category || '',
    gender: r.gender ?? '',
    previewUrl: r.url_thumbnail?.[0] ?? r.previewUrl ?? r.thumbnailUrl ?? '',
    downloadUrl: r.url_asset?.[0] ?? r.downloadUrl ?? '',
  }));
}

async function buildAssetEmbeddings(assets: Asset[]): Promise<void> {
  embeddedAssets = await Promise.all(
    assets.map(async (asset) => ({
      asset,
      embedding: await embed(`${asset.name} ${asset.gender} ${asset.styleType}`),
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

export async function searchAssets(query: string, topN = 5): Promise<Asset[]> {
  if (embeddedAssets.length === 0) return [];
  const queryEmbedding = await embed(query);
  return embeddedAssets
    .map(({ asset, embedding }) => ({
      asset,
      score: cosineSimilarity(queryEmbedding, embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((s) => s.asset);
}

export function formatAssetResults(assets: Asset[]): string {
  if (assets.length === 0) {
    return "I couldn't find any assets matching your request. Try searching with different keywords (e.g. gender, item type).";
  }
  const lines = assets.map((a) => {
    const meta = [a.gender, a.styleType].filter(Boolean).join(', ');
    const preview = a.previewUrl ? ` ![${a.name}](${a.previewUrl})` : '';
    return `- **${a.name}**${meta ? ` (${meta})` : ''}: [Download](${a.downloadUrl})${preview}`;
  });
  return `Here are the matching assets from the library:\n\n${lines.join('\n')}`;
}
