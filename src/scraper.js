import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, 'assets.json');
const CDN_BASE = 'https://d3iunbgdtjpgwl.cloudfront.net/v1';

export function loadCache() {
  if (fs.existsSync(CACHE_FILE)) {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  }
  return { assets: [], lastUpdated: null };
}

function saveCache(cache) {
  cache.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function nameToFilename(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function analyzeColor(client, imageUrl) {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: '이 의류의 주요 색상을 한국어 한 단어로만 답하세요. (예: 흰색, 검정, 빨간색, 파란색, 초록색, 베이지, 회색, 청록색, 네이비 등)' }
        ]
      }]
    });
    return response.content[0].text.trim();
  } catch (e) {
    console.error('Vision 분석 실패:', e.message);
    return '알 수 없음';
  }
}

async function fetchAssetList() {
  try {
    const response = await fetch('https://api.z-emotion.com/prod/v2/assets/take?limit=500&skip=0', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://z-emotion.com/',
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    console.log('API 응답 키:', Object.keys(data));

    // 응답 구조 탐색 (최대 2단계 깊이)
    if (Array.isArray(data)) return data;

    const search = (obj, depth = 0) => {
      if (depth > 2) return null;
      for (const key of ['assets', 'items', 'list', 'results', 'content']) {
        if (Array.isArray(obj[key]) && obj[key].length > 0) {
          console.log(`에셋 발견 (depth=${depth}): ${obj[key].length}개`);
          return obj[key];
        }
      }
      for (const val of Object.values(obj)) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const found = search(val, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };

    const found = search(data);
    if (!found) console.log('API 응답 구조:', JSON.stringify(data).substring(0, 300));
    return found;
  } catch (e) {
    console.error('API 호출 실패:', e.message);
    return null;
  }
}

export async function syncAssets() {
  const client = new Anthropic();
  const cache = loadCache();
  const cachedIds = new Set(cache.assets.map(a => a.assetId));

  console.log('z-emotion 에셋 목록 가져오는 중...');
  const rawAssets = await fetchAssetList();

  if (!rawAssets || rawAssets.length === 0) {
    console.log('자동 스크래핑 실패.');
    console.log('debug_page.html을 확인하거나 assets.json에 수동으로 에셋을 추가하세요.');
    return cache.assets;
  }

  const newAssets = rawAssets.filter(a => {
    const id = a.assetId || a.id || a._id;
    return id && !cachedIds.has(id);
  });

  console.log(`전체: ${rawAssets.length}개, 신규: ${newAssets.length}개`);

  for (const raw of newAssets) {
    const assetId = raw.assetId || raw.id || raw._id;
    const name = raw.assetName || raw.name || raw.title || 'Unknown';
    const previewUrl = (raw.url_thumbnail?.[0]) || raw.previewUrl || raw.thumbnailUrl ||
                       `${CDN_BASE}/${assetId}/garment/preview.png`;
    const downloadUrl = (raw.url_asset?.[0]) || raw.downloadUrl ||
                        `${CDN_BASE}/${assetId}/garment/asset/${nameToFilename(name)}.zls`;
    const styleType = [raw.category_sub, raw.category_sub_sub].filter(Boolean).join(' > ') ||
                      raw.styleType || raw.category || '';

    console.log(`색상 분석 중: ${name}`);
    const color = await analyzeColor(client, previewUrl);

    cache.assets.push({
      assetId,
      name,
      styleType,
      gender: raw.gender || '',
      color,
      previewUrl,
      downloadUrl
    });

    saveCache(cache); // 매 에셋마다 저장
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`동기화 완료. 총 에셋: ${cache.assets.length}개`);
  return cache.assets;
}
