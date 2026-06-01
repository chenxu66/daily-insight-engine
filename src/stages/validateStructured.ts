import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import type { CleanedNewsItem, StructuredNewsItem } from '../types.js';
import { StructuredNewsItemSchema } from '../schema.js';
import { config } from '../config.js';
import { createLogger } from '../util/logger.js';
import { artifactDir, artifactPath } from '../util/paths.js';

const logger = createLogger('validateStructured');

type ErrorRecord = { __extraction_error: true; title: string; source: string };
type RawRecord = StructuredNewsItem | ErrorRecord;

type FlattenedZodError = {
  formErrors: string[];
  fieldErrors: Record<string, string[] | undefined>;
};

type InvalidatedRecord = {
  zodErrors: FlattenedZodError | null;
  originalItem: CleanedNewsItem | null;
};

function buildSingleItemPrompt(item: CleanedNewsItem): string {
  return `You are a structured AI news extraction assistant. Convert this article into a structured JSON record.

Return ONLY a JSON object — no explanation, no markdown fences, no extra text. The object must have these fields:
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
- For HackerNews items (source = "HackerNews"): score >= 250 → "high", score >= 100 → "mid", otherwise → "low". If score is N/A, use content-based heuristics.
- For qbitai items (source = "qbitai"): major product release / AI funding >= $50M / important policy announcement / major research breakthrough → "high"; notable but smaller-scale items → "mid"; everything else → "low".

Article to process:
- title: ${item.title}
- source: ${item.source}
- url: ${item.url ?? 'N/A'}
- publishedAt: ${item.publishedAt}
- score: ${item.score !== undefined ? item.score : 'N/A'} (HackerNews upvote score, if applicable)
- content: ${item.content.slice(0, 1500)}

Respond with exactly one JSON object.`;
}

async function retryExtraction(
  originalItem: CleanedNewsItem,
  client: Anthropic,
): Promise<StructuredNewsItem | null> {
  const prompt = buildSingleItemPrompt(originalItem);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';
  const text = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const result = StructuredNewsItemSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

function makeKey(source: string, title: string): string {
  return `${source}::${title.trim().toLowerCase()}`;
}

export async function runValidateStructured(date: Date = new Date()): Promise<void> {
  const dateStr = date.toISOString().slice(0, 10);
  logger.info(`Starting schema validation for ${dateStr}`);

  const structuredPath = artifactPath(`structured_${dateStr}.json`, date);
  const rawData = await fs.readFile(structuredPath, 'utf-8');
  const records: RawRecord[] = JSON.parse(rawData);
  logger.info(`Input: ${records.length} structured records`);

  const cleanedPath = artifactPath(`cleaned_${dateStr}.json`, date);
  const cleanedData = await fs.readFile(cleanedPath, 'utf-8');
  const cleanedItems: CleanedNewsItem[] = JSON.parse(cleanedData);

  const cleanedMap = new Map<string, CleanedNewsItem>();
  for (const item of cleanedItems) {
    cleanedMap.set(makeKey(item.source, item.title), item);
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const validated: StructuredNewsItem[] = [];
  const invalidated: InvalidatedRecord[] = [];

  let validFirstPass = 0;
  let recoveredAfterRetry = 0;
  let finallyInvalid = 0;

  for (const record of records) {
    if ('__extraction_error' in record) {
      // Error sentinel: skip first-pass validation, go straight to retry
      const originalItem = cleanedMap.get(makeKey(record.source, record.title)) ?? null;

      if (originalItem) {
        logger.info(`Retrying error sentinel: "${record.title}"`);
        try {
          const retried = await retryExtraction(originalItem, client);
          if (retried) {
            validated.push(retried);
            recoveredAfterRetry++;
            continue;
          }
        } catch (err) {
          logger.warn(`Retry LLM call failed for: "${record.title}"`, err);
        }
      }

      invalidated.push({ zodErrors: null, originalItem });
      finallyInvalid++;
      continue;
    }

    // Validate existing structured record
    const firstResult = StructuredNewsItemSchema.safeParse(record);
    if (firstResult.success) {
      validated.push(firstResult.data);
      validFirstPass++;
      continue;
    }

    // Schema invalid: find original cleaned item and retry
    const originalItem = cleanedMap.get(makeKey(record.source, record.title)) ?? null;

    logger.info(`Schema validation failed, retrying: "${record.title}"`);

    if (originalItem) {
      try {
        const retried = await retryExtraction(originalItem, client);
        if (retried) {
          validated.push(retried);
          recoveredAfterRetry++;
          continue;
        }
      } catch (err) {
        logger.warn(`Retry LLM call failed for: "${record.title}"`, err);
      }
    }

    invalidated.push({ zodErrors: firstResult.error.flatten(), originalItem });
    finallyInvalid++;
  }

  const dir = artifactDir(date);
  await fs.mkdir(dir, { recursive: true });

  const validatedPath = artifactPath(`validated_${dateStr}.json`, date);
  const invalidatedPath = artifactPath(`invalidated_${dateStr}.json`, date);

  await fs.writeFile(validatedPath, JSON.stringify(validated, null, 2), 'utf-8');
  await fs.writeFile(invalidatedPath, JSON.stringify(invalidated, null, 2), 'utf-8');

  logger.info(
    `Summary: valid_first_pass=${validFirstPass}, recovered_after_retry=${recoveredAfterRetry}, finally_invalid=${finallyInvalid}`,
  );
  logger.info(`Wrote ${validated.length} validated records to ${validatedPath}`);
  logger.info(`Wrote ${invalidated.length} invalidated records to ${invalidatedPath}`);
}
