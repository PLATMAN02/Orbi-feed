export type Source = 'community' | 'reddit' | 'hn';

export interface Tool {
  id: string;
  url: string;
  name: string;
  title: string | null;
  summary: string;
  why_it_matters: string | null;
  source: Source;
  source_name?: string | null;
  category: string;
  tags: string[];
  submission_type: 'community' | 'web';
  score: number;
  upvotes_count: number;
  downvotes_count: number;
  created_at: string;
  og_image?: string | null;
  og_description?: string | null;
}

export interface GeneratedToolData {
  name: string;
  summary: string;
  whyItMatters: string;
  category: string;
  tags: string[];
}

export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
}
