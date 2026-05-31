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
}

export interface StructuredNewsItem {
  title: string;
  url?: string;
  publishedAt: string;
  source: string;
  summary: string;
  keyPoints: string[];
  category: string;
  sentiment: "positive" | "negative" | "neutral";
  relevanceScore: number;
}

export interface DailyReport {
  date: string;
  generatedAt: string;
  totalArticles: number;
  topStories: StructuredNewsItem[];
  categorySummaries: Record<string, string>;
  executiveSummary: string;
}
