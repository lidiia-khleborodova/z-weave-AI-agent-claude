import * as https from 'https';
import * as http from 'http';

function fetchRaw(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; help-center-agent/1.0)',
        Accept: 'text/html',
      },
    };

    const requester = parsedUrl.protocol === 'https:' ? https : http;
    const req = requester.request(options, (res) => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        resolve(fetchRaw(res.headers.location));
        return;
      }

      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function extractNextData(html: string): string {
  // Pull the __NEXT_DATA__ JSON blob embedded by Next.js
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return '';

  try {
    const data = JSON.parse(match[1]);
    // The English i18n strings live here
    const en = data?.props?.pageProps?._nextI18Next?.initialI18nStore?.en;
    if (!en) return '';

    // Flatten all English strings into readable key: value lines
    function flatten(obj: unknown, prefix = ''): string[] {
      if (typeof obj === 'string') return [`${prefix}: ${obj}`];
      if (typeof obj !== 'object' || obj === null) return [];
      return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
        flatten(v, prefix ? `${prefix}.${k}` : k)
      );
    }

    return flatten(en).join('\n');
  } catch {
    return '';
  }
}

export async function fetchPageContent(url: string): Promise<string> {
  const html = await fetchRaw(url);
  const content = extractNextData(html);
  if (!content) throw new Error(`No readable content found at ${url} (page may be fully JS-rendered)`);
  return content;
}
