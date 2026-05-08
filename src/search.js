import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const API_URL = 'https://api.z-emotion.com/prod/v2/assets/take?limit=500&skip=0';

// 사용자 메시지에서 검색 의도 추출
export async function extractIntent(message) {
  const res = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `사용자 메시지: "${message}"

아래 JSON 형식으로만 답하세요:
{
  "category": "Dress|Skirt|Coat|Jacket|Pants|Top|Blouse|Hoodie|Jumpsuit|Vest|Shorts|Cardigan|Knit|Shirt|Swimwear|Leggings|Suit|Cape|Uniform|Cut and sew|Woven|Fabric|null",
  "color": "찾는 색상 한국어 (없으면 null)",
  "colorRange": "해당 색상과 시각적으로 유사한 색상들 쉼표로 나열 (없으면 null)",
  "gender": "Women|Men|null"
}

category는 영어로. colorRange는 경계를 넓게 정의하세요.`
    }]
  });

  try {
    const json = res.content[0].text.match(/\{[\s\S]*\}/)[0];
    return JSON.parse(json);
  } catch {
    return { category: null, color: null, colorRange: null, gender: null };
  }
}

// 전체 에셋 목록 가져오기
async function fetchAllAssets() {
  const res = await fetch(API_URL);
  const data = await res.json();
  return data?.data?.assets ?? [];
}

// Vision + 메타데이터로 종류 및 색상 동시 판단
async function checkAsset(asset, intent) {
  const previewUrl = asset.url_thumbnail?.[0];
  if (!previewUrl) return false;

  // 메타데이터 구성 (Vision에 컨텍스트로 전달)
  const colorMeta = Array.isArray(asset.color) ? asset.color.join(', ') : asset.color;
  const meta = [
    asset.category && `대분류: ${asset.category}`,
    asset.category_sub && `카테고리: ${asset.category_sub}`,
    asset.category_sub_sub && `세부분류: ${asset.category_sub_sub}`,
    asset.assetName && `이름: ${asset.assetName}`,
    colorMeta && `색상(메타): ${colorMeta}`,
    asset.item_type && `타입: ${asset.item_type}`,
  ].filter(Boolean).join(', ');

  const colorPart = intent.colorRange
    ? `\n2. 색상이 다음 중 하나인가요: ${intent.colorRange}`
    : '';

  const prompt = `이미지를 먼저 보고 판단하세요:
1. 이것이 "${intent.category}"인가요?${colorPart}

이미지로 판단이 어려울 때만 아래 메타데이터를 보조 참고하세요:
(메타: ${meta})

${intent.colorRange ? '"종류일치,색상일치" / "종류일치,색상불일치" / "종류불일치" 중 하나로만 답하세요.' : '"해당" 또는 "아님"으로만 답하세요.'}`;

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: previewUrl } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const answer = res.content[0].text.trim();

    if (intent.colorRange) {
      return answer.includes('종류일치') && answer.includes('색상일치');
    } else {
      return answer.startsWith('해당');
    }
  } catch {
    return false;
  }
}

// 메인 검색 함수
export async function searchAssets(message) {
  const intent = await extractIntent(message);
  console.log('검색 의도:', intent);

  if (!intent.category) {
    return { notFound: true, reason: 'category' };
  }

  const allAssets = await fetchAllAssets();

  // 메타데이터로 1차 필터 (넓게) — category 상위 필드도 포함
  const candidates = allAssets.filter(a => {
    const fields = [a.category, a.category_sub, a.category_sub_sub, a.assetName, a.item_type]
      .filter(Boolean).join(' ').toLowerCase();
    const cat = intent.category.toLowerCase();
    return fields.includes(cat) || cat.split(' ').some(w => w.length > 2 && fields.includes(w));
  });

  const gender = intent.gender?.toLowerCase();
  const filtered = gender
    ? candidates.filter(a => a.gender?.toLowerCase().includes(gender))
    : candidates;

  console.log(`메타 필터 후: ${filtered.length}개`);

  if (filtered.length === 0) {
    return { notFound: true, reason: 'noAssets' };
  }

  // 색상 없으면 메타 필터 결과 반환
  if (!intent.color || !intent.colorRange) {
    return { assets: filtered.slice(0, 5).map(formatAsset) };
  }

  console.log(`색상 범위: ${intent.colorRange}`);

  // Vision + 메타데이터로 종류 & 색상 동시 판단
  const matched = [];
  for (const asset of filtered) {
    const isMatch = await checkAsset(asset, intent);
    console.log(`${asset.assetName}: ${isMatch ? '✓' : '✗'}`);
    if (isMatch) matched.push(formatAsset(asset));
    if (matched.length >= 5) break;
  }

  return { assets: matched };
}

function formatAsset(raw) {
  return {
    name: raw.assetName || raw.name,
    styleType: [raw.category_sub, raw.category_sub_sub].filter(Boolean).join(' > '),
    gender: raw.gender || '',
    previewUrl: raw.url_thumbnail?.[0] || '',
    downloadUrl: raw.url_asset?.[0] || ''
  };
}
