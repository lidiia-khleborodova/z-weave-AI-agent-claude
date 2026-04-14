export interface ZendeskArticle {
  id: number;
  title: string;
  body: string; // raw HTML
  html_url: string;
  section_id: number;
  locale: string;
  updated_at: string;
  draft: boolean;
}

export interface ParsedArticle {
  id: number;
  title: string;
  body: string; // plain text
  url: string;
  updated_at: string;
}
