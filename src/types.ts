export interface ZendeskSection {
  id: number;
  name: string;
  category_id: number;
}

export interface ZendeskCategory {
  id: number;
  name: string;
}

export interface ZendeskArticlesResponse {
  articles: ZendeskArticle[];
  next_page: string | null;
  count: number;
}

export interface ZendeskSectionsResponse {
  sections: ZendeskSection[];
  next_page: string | null;
}

export interface ZendeskCategoriesResponse {
  categories: ZendeskCategory[];
  next_page: string | null;
}

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

export interface ArticleImage {
  alt: string;
  src: string;
  embedding?: number[];
}

export interface ParsedArticle {
  id: number;
  title: string;
  body: string; // plain text
  url: string;
  section: string;
  updated_at: string;
  images: ArticleImage[];
}
