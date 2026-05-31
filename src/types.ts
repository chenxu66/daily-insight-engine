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

export interface EvidencedClaim {
  text: string;
  evidence_ids: string[];
}

export interface EvidenceIndex {
  evidence_id: string;
  title: string;
  source: string;
  url?: string;
}

export interface DailyReport {
  date: string;
  generatedAt: string;
  totalArticles: number;
  evidenceIndex: EvidenceIndex[];
  executiveSummary: EvidencedClaim;
  topEvents: Array<{ title: string; analysis: EvidencedClaim }>;
  trends: EvidencedClaim[];
  alerts: Array<{ type: 'risk' | 'opportunity'; description: string; evidence_ids: string[] }>;
  categorySummaries: Record<string, EvidencedClaim>;
}
