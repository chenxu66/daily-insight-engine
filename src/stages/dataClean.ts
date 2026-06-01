import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import type { CleanedNewsItem, RawNewsItem } from '../types.js';
import { config } from '../config.js';
import { createLogger } from '../util/logger.js';
import { artifactDir, artifactPath } from '../util/paths.js';

const logger = createLogger('dataClean');

// Unambiguous AI/ML terms — any match → clearly_ai
const STRONG_AI_KEYWORDS: string[] = [
  'llm', 'large language model', 'gpt', 'chatgpt', 'openai', 'anthropic',
  'neural network', 'deep learning', 'machine learning', 'diffusion model',
  'generative ai', 'artificial intelligence', 'foundation model', 'language model',
  'stable diffusion', 'midjourney', 'dall-e', 'dall·e', 'copilot',
  'hugging face', 'fine-tuning', 'fine tuning', 'retrieval augmented',
  '大模型', '人工智能', '机器学习', 'text-to-image', 'text to image',
  'transformer architecture', 'attention mechanism', 'chatbot',
  'mistral ai', 'ai agent', 'ai model', 'ai-powered', 'ai powered',
  'natural language processing', 'generative model', 'multimodal model',
  'embedding model', 'vector database', 'gpt-4', 'gpt-3', 'gpt4', 'gpt3',
  'claude 3', 'claude opus', 'claude sonnet', 'claude haiku',
  'gemini pro', 'gemini ultra', 'gemini flash', 'gemini 2', 'gemini 1',
  'llama 2', 'llama 3', 'mistral 7b', 'falcon model', 'computer vision model',
];

// Ambiguous terms that alone suggest borderline AI relevance
const WEAK_AI_KEYWORDS: string[] = [
  'gemini', 'claude', 'neural', 'transformer', 'robotics', 'automation',
  'machine intelligence', '模型', '算法',
];

type AiBucket = 'clearly_ai' | 'borderline' | 'clearly_not_ai';

function classifyKeywords(item: RawNewsItem): AiBucket {
  const text = `${item.title} ${item.content ?? ''}`.toLowerCase();

  for (const kw of STRONG_AI_KEYWORDS) {
    if (text.includes(kw)) return 'clearly_ai';
  }

  // \bai\b matches standalone "AI" without catching substrings like "rain" or "fail"
  if (/\bai\b/.test(text)) return 'borderline';

  for (const kw of WEAK_AI_KEYWORDS) {
    if (text.includes(kw)) return 'borderline';
  }

  return 'clearly_not_ai';
}

interface FilterEntry {
  id: string;
  title: string;
  source: string;
  reason: 'duplicate' | 'not_ai_related' | 'llm_excluded';
}

async function checkBorderlineWithLLM(
  items: Array<{ id: string; item: RawNewsItem }>,
  client: Anthropic,
): Promise<Set<string>> {
  const itemList = items
    .map(({ id, item }) => `- id: "${id}", title: "${item.title.replace(/"/g, '\\"')}"`)
    .join('\n');

  const prompt = `You are an AI news relevance classifier. For each article below, decide whether it is genuinely about AI/ML technology, models, research, or applications. Respond with ONLY a JSON array — no explanation, no markdown fences. Each element must have "id" (string) and "keep" (boolean).

Articles:
${itemList}

Example response format:
[{"id":"item-0","keep":true},{"id":"item-1","keep":false}]`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]';
  const text = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  let decisions: Array<{ id: string; keep: boolean }>;
  try {
    decisions = JSON.parse(text);
  } catch {
    logger.warn('LLM returned invalid JSON; keeping all borderline items as fallback', { text });
    return new Set(items.map(({ id }) => id));
  }

  const keepSet = new Set<string>();
  for (const d of decisions) {
    if (d.keep) keepSet.add(d.id);
  }
  return keepSet;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function runDataClean(date: Date = new Date()): Promise<CleanedNewsItem[]> {
  const dateStr = date.toISOString().slice(0, 10);
  logger.info(`Starting data cleaning for ${dateStr}`);

  const rawPath = artifactPath(`raw_${dateStr}.json`, date);
  const rawData = await fs.readFile(rawPath, 'utf-8');
  const rawItems: RawNewsItem[] = JSON.parse(rawData);
  logger.info(`Input: ${rawItems.length} items`);

  const filterLog: FilterEntry[] = [];
  const dedupedItems: Array<{ id: string; item: RawNewsItem }> = [];

  const seenTitles = new Set<string>();
  const seenUrls = new Set<string>();

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const id = `item-${i}`;
    const normTitle = normalizeTitle(item.title);

    const isDupTitle = seenTitles.has(normTitle);
    const isDupUrl = item.url !== undefined && seenUrls.has(item.url);

    if (isDupTitle || isDupUrl) {
      filterLog.push({ id, title: item.title, source: item.source, reason: 'duplicate' });
    } else {
      seenTitles.add(normTitle);
      if (item.url) seenUrls.add(item.url);
      dedupedItems.push({ id, item });
    }
  }

  const dupCount = filterLog.length;
  logger.info(`After dedup: ${dedupedItems.length} kept, ${dupCount} duplicates removed`);

  const clearlyAi: Array<{ id: string; item: RawNewsItem }> = [];
  const borderline: Array<{ id: string; item: RawNewsItem }> = [];
  const clearlyNotAi: Array<{ id: string; item: RawNewsItem }> = [];

  for (const entry of dedupedItems) {
    const bucket = classifyKeywords(entry.item);
    if (bucket === 'clearly_ai') clearlyAi.push(entry);
    else if (bucket === 'borderline') borderline.push(entry);
    else clearlyNotAi.push(entry);
  }

  logger.info(
    `Keyword classification: clearly_ai=${clearlyAi.length}, borderline=${borderline.length}, clearly_not_ai=${clearlyNotAi.length}`,
  );

  for (const { id, item } of clearlyNotAi) {
    filterLog.push({ id, title: item.title, source: item.source, reason: 'not_ai_related' });
  }

  const llmKeptItems: Array<{ id: string; item: RawNewsItem }> = [];
  let llmExcluded = 0;

  if (borderline.length > 0) {
    logger.info(`Sending ${borderline.length} borderline items to claude-sonnet-4-5`);
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    try {
      const keepSet = await checkBorderlineWithLLM(borderline, client);

      for (const entry of borderline) {
        if (keepSet.has(entry.id)) {
          llmKeptItems.push(entry);
        } else {
          filterLog.push({
            id: entry.id,
            title: entry.item.title,
            source: entry.item.source,
            reason: 'llm_excluded',
          });
          llmExcluded++;
        }
      }
    } catch (err) {
      logger.warn('LLM call failed; keeping all borderline items as fallback', err);
      llmKeptItems.push(...borderline);
    }
  }

  const llmKept = llmKeptItems.length;
  logger.info(`LLM result: kept=${llmKept}, excluded=${llmExcluded}`);

  const allKept = [...clearlyAi, ...llmKeptItems];

  const cleanedItems: CleanedNewsItem[] = allKept.map(({ item }) => ({
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    source: item.source,
    content: item.content ?? '',
    wordCount: (item.content ?? '').split(/\s+/).filter(Boolean).length,
    score: item.score,
  }));

  const dir = artifactDir(date);
  await fs.mkdir(dir, { recursive: true });

  const cleanedPath = artifactPath(`cleaned_${dateStr}.json`, date);
  await fs.writeFile(cleanedPath, JSON.stringify(cleanedItems, null, 2), 'utf-8');
  logger.info(`Wrote ${cleanedItems.length} cleaned items to ${cleanedPath}`);

  const filterPath = artifactPath(`filter_${dateStr}.json`, date);
  await fs.writeFile(filterPath, JSON.stringify(filterLog, null, 2), 'utf-8');
  logger.info(`Wrote ${filterLog.length} filter entries to ${filterPath}`);

  const notAiCount = filterLog.filter((f) => f.reason === 'not_ai_related').length;
  const llmExcludedCount = filterLog.filter((f) => f.reason === 'llm_excluded').length;
  logger.info(
    `Summary: input=${rawItems.length}, kept=${cleanedItems.length}, ` +
      `filtered_duplicate=${dupCount}, filtered_not_ai=${notAiCount}, ` +
      `filtered_llm=${llmExcludedCount}, borderline_sent_to_llm=${borderline.length}`,
  );

  return cleanedItems;
}
