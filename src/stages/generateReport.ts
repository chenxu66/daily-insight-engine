import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import type { CleanedNewsItem, DailyReport, EvidenceIndex, StructuredNewsItem } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../util/logger.js';
import { artifactDir, artifactPath } from '../util/paths.js';

const logger = createLogger('generateReport');

type ValidatedItem = StructuredNewsItem & { evidence_id: string };

function buildReportPrompt(
  dateStr: string,
  validatedItems: ValidatedItem[],
  cleanedItems: CleanedNewsItem[],
): string {
  const cleanedMap = new Map<string, CleanedNewsItem>();
  for (const item of cleanedItems) {
    cleanedMap.set(`${item.source}::${item.title.trim().toLowerCase()}`, item);
  }

  const evidenceList = validatedItems.map((item) => {
    const cleaned = cleanedMap.get(`${item.source}::${item.title.trim().toLowerCase()}`);
    return {
      evidence_id: item.evidence_id,
      title: item.title,
      source: item.source,
      category: item.category,
      sentiment: item.sentiment,
      impact_level: item.impact_level,
      relevanceScore: item.relevanceScore,
      summary: item.summary,
      keyPoints: item.keyPoints,
      sourceExcerpt: cleaned ? cleaned.content.slice(0, 500) : undefined,
    };
  });

  return `You are an expert AI industry analyst. Today is ${dateStr}. Analyze the following ${validatedItems.length} validated AI news items and produce a comprehensive daily insight report.

Return ONLY a JSON object with this exact structure (no markdown fences, no extra text):
{
  "executiveSummary": {
    "text": "2-4 paragraph overview of today's AI landscape",
    "evidence_ids": ["e001", "e003"]
  },
  "topEvents": [
    {
      "title": "Short event title",
      "analysis": {
        "text": "In-depth analysis of this event and its implications",
        "evidence_ids": ["e001"]
      }
    }
  ],
  "trends": [
    {
      "text": "Description of an emerging trend or pattern observed across multiple items",
      "evidence_ids": ["e002", "e005"]
    }
  ],
  "alerts": [
    {
      "type": "risk",
      "description": "Description of the risk",
      "evidence_ids": ["e004"]
    },
    {
      "type": "opportunity",
      "description": "Description of the opportunity",
      "evidence_ids": ["e007"]
    }
  ],
  "categorySummaries": {
    "Research": {
      "text": "Summary of research developments",
      "evidence_ids": ["e001", "e007"]
    }
  }
}

Constraints:
- Include 3-7 topEvents ordered by significance (high impact_level first)
- Include 2-5 trends
- Include 2-5 alerts (mix of risk and opportunity types)
- Include one categorySummaries entry per distinct category in the data
- Every "text" analytical claim MUST include evidence_ids referencing the items that support it
- Only use evidence_ids that appear in the evidence list below
- Be specific and insightful; highlight implications for stakeholders

Evidence items:
${JSON.stringify(evidenceList, null, 2)}`;
}

export async function runGenerateReport(date: Date = new Date()): Promise<DailyReport> {
  const dateStr = date.toISOString().slice(0, 10);
  logger.info(`Generating daily report for ${dateStr}`);

  const validatedPath = artifactPath(`validated_${dateStr}.json`, date);
  const cleanedPath = artifactPath(`cleaned_${dateStr}.json`, date);

  const [validatedData, cleanedData] = await Promise.all([
    fs.readFile(validatedPath, 'utf-8'),
    fs.readFile(cleanedPath, 'utf-8'),
  ]);

  const validatedRaw: StructuredNewsItem[] = JSON.parse(validatedData);
  const cleanedItems: CleanedNewsItem[] = JSON.parse(cleanedData);

  const validatedItems: ValidatedItem[] = validatedRaw.map((item, idx) => ({
    ...item,
    evidence_id: `e${String(idx + 1).padStart(3, '0')}`,
  }));

  logger.info(
    `Input: ${validatedItems.length} validated items, ${cleanedItems.length} cleaned items`,
  );

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const prompt = buildReportPrompt(dateStr, validatedItems, cleanedItems);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const text = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  let llmReport: Partial<
    Pick<
      DailyReport,
      'executiveSummary' | 'topEvents' | 'trends' | 'alerts' | 'categorySummaries'
    >
  >;
  try {
    llmReport = JSON.parse(text);
  } catch {
    logger.warn('Failed to parse LLM report response as JSON; using empty report skeleton');
    llmReport = {};
  }

  const evidenceIndex: EvidenceIndex[] = validatedItems.map((item) => ({
    evidence_id: item.evidence_id,
    title: item.title,
    source: item.source,
    url: item.url,
  }));

  const report: DailyReport = {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    totalArticles: validatedItems.length,
    evidenceIndex,
    executiveSummary: llmReport.executiveSummary ?? { text: '', evidence_ids: [] },
    topEvents: llmReport.topEvents ?? [],
    trends: llmReport.trends ?? [],
    alerts: llmReport.alerts ?? [],
    categorySummaries: llmReport.categorySummaries ?? {},
  };

  const dir = artifactDir(date);
  await fs.mkdir(dir, { recursive: true });

  const reportPath = artifactPath(`report_${dateStr}.json`, date);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  logger.info(`Wrote report to ${reportPath}`);
  logger.info(
    `Summary: topEvents=${report.topEvents.length}, trends=${report.trends.length}, alerts=${report.alerts.length}, categories=${Object.keys(report.categorySummaries).length}`,
  );

  return report;
}
