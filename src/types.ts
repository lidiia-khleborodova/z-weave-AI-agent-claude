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

export interface Asset {
  assetId: string;
  name: string;
  category: string;       // 'garment' | 'fabric'
  styleType: string;
  gender: string;
  color: string[];
  texture: string;
  composition: string;
  fileType: string;       // 'zls' | 'u3ma'
  previewUrl: string;
  downloadUrl: string;
}

export interface EmbeddedAsset {
  asset: Asset;
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
