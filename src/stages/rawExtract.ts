import fs from 'fs/promises';
import { fetchHackerNews } from '../ingestion/hackernews.js';
import { fetchQbitAI } from '../ingestion/qbitai.js';
import type { RawNewsItem } from '../types.js';
import { createLogger } from '../util/logger.js';
import { artifactDir, artifactPath } from '../util/paths.js';

const logger = createLogger('rawExtract');

// Keywords checked case-insensitively against title+content to determine AI relevance.
// English terms: major model families, company names, and core ML concepts.
// Chinese terms: 大模型 (large model), 人工智能 (artificial intelligence), 机器学习 (machine learning).
const AI_KEYWORDS: string[] = [
  'AI',
  'LLM',
  'GPT',
  'Claude',
  'Gemini',
  'machine learning',
  'neural',
  'OpenAI',
  'Anthropic',
  'deep learning',
  'transformer',
  'diffusion model',
  'chatbot',
  'large language model',
  'generative AI',
  'artificial intelligence',
  '大模型',
  '人工智能',
  '机器学习',
];

function isAIRelated(item: RawNewsItem): boolean {
  const text = `${item.title} ${item.content ?? ''}`;
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

export async function runRawExtract(date: Date = new Date()): Promise<RawNewsItem[]> {
  const dateStr = date.toISOString().slice(0, 10);
  logger.info(`Starting raw extraction for ${dateStr}`);

  const [hnItems, qbitaiItems] = await Promise.all([
    fetchHackerNews(),
    fetchQbitAI(),
  ]);

  logger.info(`HackerNews fetched: ${hnItems.length}`);
  logger.info(`QbitAI fetched: ${qbitaiItems.length}`);

  const allItems = [...hnItems, ...qbitaiItems];

  const filtered = allItems.filter(isAIRelated);

  const hnKept = filtered.filter((i) => i.source === 'HackerNews').length;
  const qbitaiKept = filtered.filter((i) => i.source === 'qbitai').length;
  logger.info(`HackerNews kept after AI filter: ${hnKept} / ${hnItems.length}`);
  logger.info(`QbitAI kept after AI filter: ${qbitaiKept} / ${qbitaiItems.length}`);
  logger.info(`Total kept: ${filtered.length} / ${allItems.length}`);

  const dir = artifactDir(date);
  await fs.mkdir(dir, { recursive: true });

  const outPath = artifactPath(`raw_${dateStr}.json`, date);
  await fs.writeFile(outPath, JSON.stringify(filtered, null, 2), 'utf-8');
  logger.info(`Wrote ${filtered.length} items to ${outPath}`);

  return filtered;
}
