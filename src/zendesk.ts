import * as https from 'https';
import * as http from 'http';
import { ZendeskArticle, ParsedArticle } from './types';

const SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN!;
const EMAIL = process.env.ZENDESK_EMAIL!;
const API_TOKEN = process.env.ZENDESK_API_TOKEN!;

function getAuthHeader(): string {
  const credentials = Buffer.from(`${EMAIL}/token:${API_TOKEN}`).toString('base64');
  return `Basic ${credentials}`;
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json',
      },
    };

    const requester = parsedUrl.protocol === 'https:' ? https : http;
    const req = requester.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/* workaround for videos at the same page
 */
function extractYoutubeVideos(html: string): { title: string; url: string }[] {
  const videos: { title: string; url: string }[] = [];
  // Match h2 titles and the oembed URL that follows them
  const regex = /<h2[^>]*>[\s\S]*?<br[^>]*>([\s\S]*?)<\/h2>[\s\S]*?data-oembed-url="(https:\/\/www\.youtube\.com\/watch\?v=[^"]+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const title = match[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
    const url = match[2].replace(/&amp;/g, '&');
    if (title) videos.push({ title, url });
  }
  // Fall back: extract URLs without titles for any remaining videos
  const paired = new Set(videos.map((v) => v.url));
  const bareRegex = /data-oembed-url="(https:\/\/www\.youtube\.com\/watch\?v=[^"]+)"/g;
  while ((match = bareRegex.exec(html)) !== null) {
    const url = match[1].replace(/&amp;/g, '&');
    if (!paired.has(url)) videos.push({ title: '', url });
  }
  return videos;
}

function stripHtml(html: string): string {
  let text = html.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Collapse multiple blank lines and trim
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

interface ZendeskArticlesResponse {
  articles: ZendeskArticle[];
  next_page: string | null;
  count: number;
}

export async function fetchAllArticles(): Promise<ParsedArticle[]> {
  const baseUrl = `https://${SUBDOMAIN}/api/v2/help_center/articles.json`;
  const allArticles: ZendeskArticle[] = [];

  let nextPage: string | null = `${baseUrl}?per_page=100`;

  console.log('Fetching articles from Zendesk...');

  while (nextPage !== null) {
    const url: string = nextPage;
    const response: ZendeskArticlesResponse = await fetchJson<ZendeskArticlesResponse>(url);
    allArticles.push(...response.articles);
    nextPage = response.next_page;
    console.log(`  Fetched ${allArticles.length} / ${response.count} articles`);
  }

  const published = allArticles.filter((a) => !a.draft);
  console.log(`Done. ${published.length} published articles (${allArticles.length - published.length} drafts skipped).`);

  return published.map((article) => {
    const videos = extractYoutubeVideos(article.body);
    const bodyText = stripHtml(article.body);
    const videoSection = videos.length > 0
      ? '\n\nYouTube videos in this article:\n' + videos.map((v) => `- ${v.title ? v.title + ': ' : ''}${v.url}`).join('\n')
      : '';
    return {
      id: article.id,
      title: article.title,
      body: bodyText + videoSection,
      url: article.html_url,
    };
  });
}
