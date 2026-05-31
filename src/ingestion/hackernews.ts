import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import type { RawNewsItem } from '../types.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger('HackerNews');

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';

interface HNItem {
  id: number;
  type: string;
  title: string;
  url?: string;
  text?: string;
  time: number;
  score: number;
  by: string;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json() as Promise<T>;
}

async function fetchArticleContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'DailyInsightEngine/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    const text = article?.textContent?.trim();
    return text || null;
  } catch (err) {
    logger.warn(`Article fetch failed for ${url}`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function processItem(id: number): Promise<RawNewsItem | null> {
  try {
    const item = await fetchJSON<HNItem>(`${HN_BASE}/item/${id}.json`);
    if (!item || item.type !== 'story' || !item.title) return null;

    let content: string | null = null;

    if (item.text) {
      content = item.text;
    } else if (item.url) {
      content = await fetchArticleContent(item.url);
    }

    return {
      title: item.title,
      url: item.url,
      publishedAt: new Date(item.time * 1000).toISOString(),
      source: 'HackerNews',
      content,
      score: item.score,
    };
  } catch (err) {
    logger.warn(`Skipping HN item ${id}`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function fetchHackerNews(): Promise<RawNewsItem[]> {
  logger.info('Fetching HackerNews top stories');

  const topIds = await fetchJSON<number[]>(`${HN_BASE}/topstories.json`);
  const ids = topIds.slice(0, 30);

  logger.info(`Processing ${ids.length} stories`);

  const settled = await Promise.allSettled(ids.map(processItem));

  const items: RawNewsItem[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value !== null) {
      items.push(result.value);
    } else if (result.status === 'rejected') {
      logger.warn('Unexpected rejection processing HN item', String(result.reason));
    }
  }

  logger.info(`Returning ${items.length} stories`);
  return items;
}
