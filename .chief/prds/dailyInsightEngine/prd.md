# PRD: Daily AI Insight Engine

## 1. Introduction/Overview

The Daily AI Insight Engine is an automated, pipeline-based system that ingests AI-related news from multiple public sources, transforms raw articles into a structured schema using LLM-based extraction, and produces a human-readable daily report with embedded data visualizations.

It solves the problem of information overload in the rapidly evolving AI industry: practitioners, investors, and decision-makers cannot manually triage and synthesize the daily firehose of AI news. The system delivers a single, opinionated daily artifact (HTML report) that surfaces the top events, trends, risks, and opportunities, backed by evidence drawn from validated source data.

Primary use cases:
- AI industry trend analysis
- News monitoring and risk alerts
- Quick situational awareness and decision assistance

The pipeline is triggered by running `node pipeline.js` and produces dated output artifacts (JSON and HTML) for each run.

## 2. Goals

- Automatically ingest AI news daily from HackerNews top stories and qbitai.com RSS feed.
- Filter the raw corpus down to AI-relevant, de-duplicated items.
- Use Claude `claude-sonnet-4-5` to extract structured fields from each cleaned article, processing news in batches of 3 per agent invocation.
- Validate every structured record against a Zod schema with a single retry on failure.
- Produce a daily analytical report covering top events, in-depth analysis, trend assessment, and risk/opportunity alerts — every analytical claim must cite evidence from the validated data.
- Produce a visual dashboard (heatmap/wordcloud, region pie chart, sentiment distribution, top-event cards) as a self-contained HTML page.
- Combine the analytical report and the relevant charts from the dashboard into a final, integrated `report_{date}.html`.
- All stages emit dated artifacts so any single stage can be inspected, re-run, or audited.

## 3. User Stories

### US-001: Project scaffolding and shared types
**Status:** done
**Priority:** 1
**Description:** As a developer, I need a TypeScript/Node.js project scaffold with shared types, configuration loading, and a logger so all pipeline stages share a consistent foundation.

**Acceptance Criteria:**
- [x] `package.json` with TypeScript, `tsx`/`ts-node`, `zod`, `@anthropic-ai/sdk`, `rss-parser` (or equivalent), and `node-fetch` dependencies
- [x] `tsconfig.json` configured for Node.js with strict mode enabled
- [x] `src/types.ts` exports `RawNewsItem`, `CleanedNewsItem`, `StructuredNewsItem`, and `DailyReport` types
- [x] `src/config.ts` loads `ANTHROPIC_API_KEY` from environment with clear error if missing
- [x] `src/util/logger.ts` exports a logger usable by every stage with stage-tagged output
- [x] `src/util/paths.ts` produces dated artifact paths under `output/{date}/`
- [x] `npx tsc --noEmit` passes

### US-002: HackerNews ingestion (with article body fetch)
**Status:** done
**Priority:** 2
**Description:** As the pipeline, I need to fetch the top 30 HackerNews stories — including the body of the linked article when the story has a URL — so downstream stages have enough text to work with.

**Acceptance Criteria:**
- [x] Fetches `https://hacker-news.firebaseio.com/v0/topstories.json` and takes the first 30 IDs
- [x] Fetches each story's full item from `https://hacker-news.firebaseio.com/v0/item/{id}.json`
- [x] If the item has `text`, use that as the `content`
- [x] If the item has a `url`, fetch the linked page and extract the article body as `content` (use a readable-text extractor such as `@mozilla/readability` + `jsdom`, or `@extractus/article-extractor`)
- [x] If neither yields usable content, fall back to using the `title` alone with `content = null`
- [x] Each item normalized into `RawNewsItem` with `title`, `content`, `url` (if present), `source: "HackerNews"`, `publishedAt` (from `time` epoch → ISO), and the original `score` (retained for later impact mapping)
- [x] Network/parse errors on individual items (HN item fetch or article body fetch) are logged and skipped without aborting the batch
- [x] Function exposed as `fetchHackerNews(): Promise<RawNewsItem[]>`

### US-003: qbitai.com RSS ingestion
**Status:** done
**Priority:** 2
**Description:** As the pipeline, I need to fetch the qbitai.com feed so the engine includes Chinese-language AI coverage.

**Acceptance Criteria:**
- [x] Fetches and parses `https://www.qbitai.com/feed`
- [x] Each entry normalized into `RawNewsItem` with `title`, `content` (description/summary), `source: "qbitai"`, `publishedAt` (ISO)
- [x] Parsing failures are logged and do not crash the stage
- [x] Function exposed as `fetchQbitAI(): Promise<RawNewsItem[]>`

### US-004: Raw extraction stage + AI filter
**Status:** done
**Priority:** 3
**Description:** As the pipeline, I need to combine all sources, keep only AI-related items, and persist the raw set so downstream stages can be re-run from disk.

**Acceptance Criteria:**
- [x] Combines outputs of US-002 and US-003
- [x] Filters to AI-related items using a keyword heuristic on title+content (e.g. "AI", "LLM", "GPT", "Claude", "machine learning", "neural", "OpenAI", "Anthropic", "大模型", "人工智能", etc. — list documented in code)
- [x] Writes the filtered raw array to `output/{date}/raw_{date}.json`
- [x] Logs counts: per-source fetched, kept after AI filter

### US-005: Data cleaning stage (dedup + keyword + LLM borderline check)
**Status:** done
**Priority:** 4
**Description:** As the pipeline, I need to remove duplicates and confirm AI relevance — using cheap keyword rules first and an LLM only for borderline cases — and explain every exclusion, so the cleaned set is trustworthy and the filtering is auditable.

**Acceptance Criteria:**
- [x] Reads `raw_{date}.json`
- [x] De-duplicates by normalized title (lowercased, whitespace-collapsed) and by URL where present
- [x] Applies a keyword-based AI relevance classifier producing three buckets: `clearly_ai`, `borderline`, `clearly_not_ai`
- [x] Items classified `clearly_ai` are kept; items classified `clearly_not_ai` are filtered with reason `"not_ai_related"`
- [x] Items classified `borderline` are sent to `claude-sonnet-4-5` (batched, prompt asks for a JSON yes/no per item) to make the final keep/exclude call
- [x] Writes kept items to `output/{date}/cleaned_{date}.json`
- [x] Writes `output/{date}/filter_{date}.json` as an array of `{ id, title, source, reason }` for every excluded item; `reason` is one of `"duplicate"`, `"not_ai_related"`, or `"llm_excluded"`
- [x] Logs counts: input, kept, filtered by reason, and how many borderline items the LLM was invoked on

### US-006: Structured extraction schema (Zod)
**Status:** done
**Priority:** 5
**Description:** As a developer, I need a Zod schema for the structured news record so extraction and validation share a single source of truth.

**Acceptance Criteria:**
- [x] `src/schema.ts` exports `StructuredNewsItemSchema` (Zod) with fields:
  - `event_type`: enum `"product_release" | "ai_application" | "ai_funding" | "research" | "policy"`
  - `product`: string | null
  - `company`: string | null
  - `impact_level`: enum `"high" | "mid" | "low"`
  - `summary`: string
  - `related_entities`: string[] | null
  - `source`: string
  - `published_at`: string matching `YYYY-MM-DD HH:mm`
  - `sentiment`: enum `"positive" | "negative" | "neutral"`
  - `tags`: string[]
  - `industry`: string | null
  - `language`: string
  - `region`: string | null (typical values: `"CN" | "US" | "Global"` and similar)
- [x] Schema is the single source of truth for the `StructuredNewsItem` TS type (`z.infer`)
- [x] Typecheck passes

### US-007: Structural extraction with Claude (batches of 3)
**Status:** done
**Priority:** 6
**Description:** As the pipeline, I need to convert cleaned items into structured records using `claude-sonnet-4-5`, batching 3 items per LLM call so prompts stay focused.

**Acceptance Criteria:**
- [x] Reads `cleaned_{date}.json`
- [x] Splits the array into chunks of 3 items
- [x] For each chunk, makes a single Claude API call with model `claude-sonnet-4-5`
- [x] Prompt instructs the model to return a JSON array of length equal to the input chunk size, matching the schema in US-006
- [x] For HackerNews items, the prompt explicitly maps `score` → `impact_level` using the thresholds `>=250 → high`, `>=100 → mid`, otherwise `low` (note: thresholds may be tuned after observing real distribution)
- [x] For qbitai items (which have no score), the prompt instructs the model to infer `impact_level` from content using documented heuristics: major product release / AI funding ≥ $50M / important policy / major research breakthrough → `high`; notable but smaller-scale items → `mid`; everything else → `low`
- [x] Per-chunk failures (network/parse) are logged; the failed chunk's records are emitted with a sentinel `__extraction_error: true` so the validation stage can attempt a retry
- [x] Writes the combined array to `output/{date}/structured_{date}.json`
- [x] Logs counts: chunks processed, items produced, chunks that errored

### US-008: Schema validation with single retry
**Status:** done
**Priority:** 7
**Description:** As the pipeline, I need every structured record validated against the Zod schema, with one retry for invalid records, so downstream stages only see well-formed data.

**Acceptance Criteria:**
- [x] Reads `structured_{date}.json`
- [x] Validates each record with `StructuredNewsItemSchema.safeParse`
- [x] For each invalid record, re-runs structural extraction once for the original cleaned item (single-item LLM call)
- [x] Records that pass validation (originally or after retry) are written to `output/{date}/validated_{date}.json`
- [x] Records that fail both attempts are written to `output/{date}/invalidated_{date}.json` with the Zod error details and the original cleaned item attached
- [x] Logs counts: valid first pass, recovered after retry, finally invalid

### US-009: Daily analytical report generation
**Status:** done
**Priority:** 8
**Description:** As a reader, I want a daily report that highlights top events with evidence-backed analysis, trends, and risk/opportunity alerts so I can quickly understand the day's AI landscape.

**Acceptance Criteria:**
- [x] Reads `validated_{date}.json` and `cleaned_{date}.json` (for any quoted source context)
- [x] Calls `claude-sonnet-4-5` with both datasets to produce a JSON report with fields:
  - `top_events`: 3–5 items, each `{ title, summary, source, evidence_ids }`
  - `in_depth_summary`: array of `{ event_title, background, impact_analysis, evidence_ids }`
  - `trend_assessment`: `{ technology, applications, policy, capital_markets }`, each a string with `evidence_ids`
  - `risk_opportunity_alerts`: array of `{ type: "risk" | "opportunity", description, evidence_ids }`
- [x] Every analytical claim references one or more `evidence_ids` corresponding to entries in `validated_{date}.json`
- [x] Writes the report to `output/{date}/report_{date}.json`

### US-010: Visualization dashboard (index_{date}.html)
**Status:** done
**Priority:** 9
**Description:** As a reader, I want a visual dashboard so I can grasp the day's distribution of industries, tags, regions, and sentiment at a glance.

**Acceptance Criteria:**
- [x] Reads `validated_{date}.json`
- [x] Produces `output/{date}/index_{date}.html` as a single self-contained file (charts via a CDN-loaded library such as Chart.js / ECharts; wordcloud via a wordcloud library)
- [x] Includes: industry+tag heatmap or wordcloud, region pie chart, sentiment distribution chart, and a row of top-event cards (title, summary, sentiment tag, source link)
- [x] Each chart container has a stable `id` attribute (e.g. `chart-region`, `chart-sentiment`, `chart-tags`, `cards-top-events`) so US-011 can extract them
- [x] HTML opens directly in a browser without a server

### US-011: Final integrated HTML report
**Status:** done
**Priority:** 10
**Description:** As a reader, I want one final HTML report that combines the analytical narrative with the relevant charts inline so I have a single artifact to read or share.

**Acceptance Criteria:**
- [x] Reads `report_{date}.json` and `index_{date}.html`
- [x] Produces `output/{date}/report_{date}.html`
- [x] Each report section embeds the relevant chart(s) inline (e.g. the trend section embeds the tag/industry visualization; the in-depth section embeds the top-event cards; the risk/opportunity section embeds the region/sentiment charts)
- [x] Chart inclusion is implemented by extracting referenced elements from `index_{date}.html` by `id`, not by re-implementing the chart code
- [x] HTML is self-contained and opens directly in a browser

### US-012: Pipeline entrypoint
**Status:** done
**Priority:** 11
**Description:** As a user, I want to run the entire pipeline with one command so daily generation is one step.

**Acceptance Criteria:**
- [x] `pipeline.js` (or `pipeline.ts` compiled/transpiled and runnable as `node pipeline.js`) at the repo root runs stages US-004 → US-011 in order
- [x] Each stage logs its start, completion, and key counts
- [x] If a stage fails, the pipeline stops with a clear error message identifying the stage
- [x] The run date is determined once at start and reused for all artifact filenames
- [x] `README.md` documents setup (`ANTHROPIC_API_KEY`), install (`npm install`), and run (`node pipeline.js`)

## 4. Functional Requirements

- FR-1: The pipeline must fetch the top 30 HackerNews stories per run via the public HackerNews API, and for stories with a `url` it must fetch and extract the linked article body as the item's `content`.
- FR-2: The pipeline must fetch and parse the qbitai.com RSS feed per run.
- FR-3: Each raw news item must contain `title`, `content`/summary, `source`, and `publishedAt`.
- FR-4: The pipeline must filter raw items to AI-related items only, using keyword rules first and invoking an LLM only for borderline cases.
- FR-5: The pipeline must write the filtered raw set to `raw_{date}.json`.
- FR-6: The cleaning stage must de-duplicate items and exclude any non-AI items.
- FR-7: The cleaning stage must write `cleaned_{date}.json` and `filter_{date}.json` (with per-item exclusion reasons).
- FR-8: The structural extraction stage must use model `claude-sonnet-4-5`.
- FR-9: The structural extraction stage must process exactly 3 items per LLM agent call (final chunk may be smaller).
- FR-10: The structural extraction stage must map each item to the schema defined in US-006, including `event_type`, `product`, `company`, `impact_level`, `summary`, `related_entities`, `source`, `published_at` (`YYYY-MM-DD HH:mm`), `sentiment`, `tags`, `industry`, `language`, and `region`.
- FR-11: For HackerNews items, `impact_level` must be derived from the HackerNews `score` using thresholds `>=250 → high`, `>=100 → mid`, otherwise `low`. These thresholds are an MVP starting point and may be tuned after observing the real score distribution.
- FR-11a: For qbitai items (no score available), `impact_level` must be inferred by the LLM from content using heuristics: major product release, AI funding ≥ $50M, important policy change, or major research breakthrough → `high`; notable but smaller items → `mid`; everything else → `low`.
- FR-12: The structural extraction stage must write `structured_{date}.json`.
- FR-13: Records must be validated against the Zod schema. Invalid records must trigger a single re-extraction attempt; records still invalid after retry must be excluded from downstream stages.
- FR-14: The validation stage must write `validated_{date}.json` (passing records) and `invalidated_{date}.json` (failing records with Zod error info and original cleaned context).
- FR-15: The daily report must include: top 3–5 events, in-depth summary of key events (background + impact), trend assessment across technology/applications/policy/capital markets, and risk/opportunity alerts.
- FR-16: Every analytical claim in the daily report must cite at least one source record (`evidence_ids`).
- FR-17: The daily report must be written to `report_{date}.json`.
- FR-18: The visualization stage must produce `index_{date}.html` containing heatmap/wordcloud (industry + tags), region pie chart, sentiment distribution, and top-event cards.
- FR-19: The final stage must combine `report_{date}.json` and `index_{date}.html` into `report_{date}.html`, embedding the chart elements that contextually correspond to each report section.
- FR-20: The entire pipeline must be runnable with `node pipeline.js`.

## 5. Non-Goals (Out of Scope)

- No database — all artifacts are stored as JSON/HTML files on disk.
- No user accounts, authentication, or multi-user features.
- No scheduling layer (cron, GitHub Actions) — the pipeline is invoked manually for this version.
- No email, Slack, or push delivery of the report — file output only.
- No web UI for browsing historical reports — each day's artifacts live in its own dated directory.
- No additional news sources beyond HackerNews and qbitai.com in this version.
- No language translation of the source content — items keep their original language; the `language` field is recorded.
- No real-time or streaming updates — the pipeline runs end-to-end per invocation.
- No automated test suite is required for this version (typecheck only).

## 6. Design Considerations

- Output directory layout: `output/{YYYY-MM-DD}/` containing every artifact for that day, so a run is self-contained and easy to inspect.
- The visualization stage should rely on widely available CDN libraries (e.g. Chart.js or ECharts for charts, wordcloud2.js for wordclouds) so `index_{date}.html` works as a single static file with no build step.
- Top-event cards should clearly show sentiment via color cues so the dashboard communicates tone at a glance.
- The final integrated `report_{date}.html` should be readable top-to-bottom as a narrative, with charts placed beside or within the relevant section rather than dumped in an appendix.

## 7. Technical Considerations

- Runtime: Node.js + TypeScript; pipeline entry is `pipeline.js` (transpiled or run via `tsx`/`ts-node`).
- LLM client: `@anthropic-ai/sdk` with `ANTHROPIC_API_KEY` from environment; model `claude-sonnet-4-5`.
- Schema validation: `zod`. The Zod schema is the single source of truth for the `StructuredNewsItem` type.
- HackerNews API: `https://hacker-news.firebaseio.com/v0/topstories.json` then `https://hacker-news.firebaseio.com/v0/item/{id}.json` per ID — see https://github.com/HackerNews/API.
- HackerNews article body extraction: use `@mozilla/readability` + `jsdom`, or `@extractus/article-extractor`.
- qbitai feed: `https://www.qbitai.com/feed` parsed with `rss-parser` or equivalent.
- Chart libraries: loaded via CDN (e.g. Chart.js / ECharts and wordcloud2.js) — acceptable for MVP since reports are read with network access available.
- Each stage is implemented as a pure function `(input artifact path | data) -> output artifact path | data`, so any stage can be re-run by pointing at the existing prior artifact on disk.
- The structural extraction batch size is fixed at 3 to keep the prompt focused and reduce the chance of partial-array hallucinations.
- LLM responses must be parsed as JSON; instruct the model to return JSON only, with no commentary.
- Sequential rather than parallel LLM calls are acceptable for v1; if rate limits or latency become an issue, batching can be parallelized later (out of scope here).

## 8. Success Metrics

- Running `node pipeline.js` on a typical day produces all 7 expected artifacts (`raw_{date}.json`, `cleaned_{date}.json`, `filter_{date}.json`, `structured_{date}.json`, `validated_{date}.json`, `invalidated_{date}.json`, `report_{date}.json`, `index_{date}.html`, `report_{date}.html`) without manual intervention.
- ≥ 90% of structured records pass Zod validation on the first attempt; ≥ 98% pass after the single retry.
- The daily report contains exactly 3–5 top events, and 100% of analytical claims cite at least one `evidence_id`.
- A first-time reader can identify the day's top AI events and dominant sentiment from `report_{date}.html` within 60 seconds.
- Full pipeline completes end-to-end in under 5 minutes on a typical day (ignoring LLM latency variability).

## 9. Open Questions

All initial open questions have been resolved for the MVP scope:

- HN score thresholds: `>=250 → high`, `>=100 → mid`, otherwise `low` (revisit after first runs).
- qbitai impact level: inferred by the LLM from content (major product release / AI funding ≥ $50M / important policy / major research → `high`).
- AI-relevance filter: keyword classification first; LLM only for borderline items.
- HN article body: fetched and extracted for items with a `url`.
- Charts: CDN-loaded — MVP acceptable.
- Day-over-day historical comparison: out of scope for MVP.

Remaining items to revisit after the first real run:
- Are the HN score thresholds (250 / 100) producing a sensible distribution, or do they need tuning?
- Are the borderline-LLM keyword rules catching too many or too few items?
