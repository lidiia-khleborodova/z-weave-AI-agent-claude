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

function stripHtml(html: string): string {
  // Replace block-level tags with newlines to preserve structure
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');

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

  return published.map((article) => ({
    id: article.id,
    title: article.title,
    body: stripHtml(article.body),
    url: article.html_url,
    updated_at: article.updated_at,
  }));
}
