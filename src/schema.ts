import { z } from 'zod';

export const StructuredNewsItemSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  publishedAt: z.string(),
  source: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  category: z.string(),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  relevanceScore: z.number(),
});

export type StructuredNewsItem = z.infer<typeof StructuredNewsItemSchema>;
