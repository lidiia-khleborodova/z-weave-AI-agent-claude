export interface ZendeskArticle {
  id: number;
  title: string;
  body: string; // raw HTML
  html_url: string;
  section_id: number;
  locale: string;
  draft: boolean;
}

export interface Pattern {
  name: string;
  link: string;
  gender: string;
  type: string;
}

export interface EmbeddedPattern {
  pattern: Pattern;
  embedding: number[];
}

export interface ParsedArticle {
  id: number;
  title: string;
  body: string; // plain text
  url: string;
}
