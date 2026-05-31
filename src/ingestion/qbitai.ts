import Parser from 'rss-parser';
import type { RawNewsItem } from '../types.js';
import { createLogger } from '../util/logger.js';

const logger = createLogger('QbitAI');

const FEED_URL = 'https://www.qbitai.com/feed';

const parser = new Parser({
  timeout: 15_000,
  headers: { 'User-Agent': 'DailyInsightEngine/1.0' },
});

export async function fetchQbitAI(): Promise<RawNewsItem[]> {
  logger.info('Fetching QbitAI RSS feed');

  let feed: Awaited<ReturnType<typeof parser.parseURL>>;
  try {
    feed = await parser.parseURL(FEED_URL);
  } catch (err) {
    logger.warn('Failed to fetch QbitAI feed', err instanceof Error ? err.message : String(err));
    return [];
  }

  const items: RawNewsItem[] = [];

  for (const item of feed.items) {
    try {
      if (!item.title) {
        logger.warn('Skipping QbitAI item with no title');
        continue;
      }

      const content: string | null =
        (item.content ?? item.contentSnippet ?? item.summary ?? null) || null;

      const publishedAt = item.isoDate
        ? item.isoDate
        : item.pubDate
          ? new Date(item.pubDate).toISOString()
          : new Date().toISOString();

      items.push({
        title: item.title,
        url: item.link ?? undefined,
        publishedAt,
        source: 'qbitai',
        content,
      });
    } catch (err) {
      logger.warn(
        `Skipping QbitAI item "${item.title ?? '(no title)'}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logger.info(`Returning ${items.length} QbitAI items`);
  return items;
}
