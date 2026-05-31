import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import type { CleanedNewsItem, StructuredNewsItem } from '../types.js';
import { StructuredNewsItemSchema } from '../schema.js';
import { config } from '../config.js';
import { createLogger } from '../util/logger.js';
import { artifactDir, artifactPath } from '../util/paths.js';

const logger = createLogger('structuredExtract');

const CHUNK_SIZE = 3;

type ErrorRecord = { __extraction_error: true; title: string; source: string };
type OutputRecord = StructuredNewsItem | ErrorRecord;

function buildPrompt(items: CleanedNewsItem[]): string {
  const itemsText = items
    .map(
      (item, i) =>
        `Item ${i + 1}:
- title: ${item.title}
- source: ${item.source}
- url: ${item.url ?? 'N/A'}
- publishedAt: ${item.publishedAt}
- score: ${item.score !== undefined ? item.score : 'N/A'} (HackerNews upvote score, if applicable)
- content: ${item.content.slice(0, 1500)}`,
    )
    .join('\n\n');

  return `You are a structured AI news extraction assistant. Convert each article into a structured JSON record.

Return ONLY a JSON array of exactly ${items.length} objects — no explanation, no markdown fences, no extra text. Each object must have these fields:
{
  "title": string,
  "url": string (optional, omit if not available),
  "publishedAt": string (ISO date),
  "source": string,
  "summary": string (2-3 sentences capturing the key news),
  "keyPoints": string[] (3-5 concise bullet points),
  "category": string (e.g. "Research", "Product Launch", "Policy", "Funding", "Industry News"),
  "sentiment": "positive" | "negative" | "neutral",
  "relevanceScore": number (0.0-1.0, how relevant to AI/ML),
  "impact_level": "high" | "mid" | "low"
}

Impact level rules:
- For HackerNews items (source = "HackerNews"): use the "score" field to determine impact_level: score >= 250 → "high", score >= 100 → "mid", otherwise → "low". If score is N/A, fall back to content-based heuristics.
- For qbitai items (source = "qbitai"): infer impact_level from content: major product release / AI funding >= $50M / important policy announcement / major research breakthrough → "high"; notable but smaller-scale items → "mid"; everything else → "low".

Articles to process:
${itemsText}

Respond with exactly a JSON array of ${items.length} objects.`;
}

async function extractChunk(
  items: CleanedNewsItem[],
  client: Anthropic,
  chunkIndex: number,
): Promise<OutputRecord[]> {
  const prompt = buildPrompt(items);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]';
  const text = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  let parsed: unknown[];
  try {
    parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Response is not a JSON array');
  } catch (err) {
    logger.warn(`Chunk ${chunkIndex}: LLM returned invalid JSON`, {
      preview: text.slice(0, 300),
    });
    throw err;
  }

  return items.map((item, i) => {
    const raw = parsed[i];
    const result = StructuredNewsItemSchema.safeParse(raw);
    if (result.success) {
      return result.data;
    }
    logger.warn(`Chunk ${chunkIndex}, item ${i}: schema validation failed`, {
      title: item.title,
      errors: result.error.flatten(),
    });
    return { __extraction_error: true as const, title: item.title, source: item.source };
  });
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function runStructuredExtract(date: Date = new Date()): Promise<OutputRecord[]> {
  const dateStr = date.toISOString().slice(0, 10);
  logger.info(`Starting structured extraction for ${dateStr}`);

  const cleanedPath = artifactPath(`cleaned_${dateStr}.json`, date);
  const rawData = await fs.readFile(cleanedPath, 'utf-8');
  const cleanedItems: CleanedNewsItem[] = JSON.parse(rawData);
  logger.info(`Input: ${cleanedItems.length} items`);

  const chunks = chunkArray(cleanedItems, CHUNK_SIZE);
  logger.info(`Split into ${chunks.length} chunks of up to ${CHUNK_SIZE}`);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const allRecords: OutputRecord[] = [];
  let chunksProcessed = 0;
  let chunksErrored = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    logger.info(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} items)`);

    try {
      const records = await extractChunk(chunk, client, i + 1);
      allRecords.push(...records);
      chunksProcessed++;
    } catch (err) {
      logger.warn(`Chunk ${i + 1} failed; emitting error sentinels for ${chunk.length} items`, err);
      for (const item of chunk) {
        allRecords.push({ __extraction_error: true, title: item.title, source: item.source });
      }
      chunksErrored++;
      chunksProcessed++;
    }
  }

  const dir = artifactDir(date);
  await fs.mkdir(dir, { recursive: true });

  const outputPath = artifactPath(`structured_${dateStr}.json`, date);
  await fs.writeFile(outputPath, JSON.stringify(allRecords, null, 2), 'utf-8');

  const itemsProduced = allRecords.length;
  logger.info(
    `Summary: chunks_processed=${chunksProcessed}, items_produced=${itemsProduced}, chunks_errored=${chunksErrored}`,
  );
  logger.info(`Wrote ${itemsProduced} records to ${outputPath}`);

  return allRecords;
}
