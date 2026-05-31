export interface RawNewsItem {
  title: string;
  url?: string;
  publishedAt: string;
  source: string;
  content: string | null;
  score?: number;
}

export interface CleanedNewsItem {
  title: string;
  url?: string;
  publishedAt: string;
  source: string;
  content: string;
  wordCount: number;
  score?: number;
}

export type { StructuredNewsItem } from './schema.js';
import type { StructuredNewsItem } from './schema.js';

export interface DailyReport {
  date: string;
  generatedAt: string;
  totalArticles: number;
  topStories: StructuredNewsItem[];
  categorySummaries: Record<string, string>;
  executiveSummary: string;
}
