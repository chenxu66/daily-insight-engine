export interface RawNewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  content?: string;
  summary?: string;
}

export interface CleanedNewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  content: string;
  wordCount: number;
}

export interface StructuredNewsItem {
  title: string;
  link: string;
  pubDate: string;
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
