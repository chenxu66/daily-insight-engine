## Codebase Patterns
- Use `Node16` module resolution in tsconfig — required for proper ESM `.js` extension imports from `.ts` files
- HTML dashboard: embed JSON data as `var dashData = ${safeJson}` with `</g, '\\u003c')` replacement to prevent `</script>` injection; use `<\/script>` in template literals for CDN closing tags
- `src/util/paths.ts` imports config using `../config.js` (with `.js` extension) due to Node16 module resolution
- `config.ts` uses lazy getter pattern so `ANTHROPIC_API_KEY` is only validated when accessed, not at module load time
- All stage-specific logging goes through `createLogger(stageName)` from `src/util/logger.ts`
- Artifact output paths are produced by `artifactPath(filename, date?)` from `src/util/paths.ts` under `output/{YYYY-MM-DD}/`
- Use native `fetch` (Node 18+ global) — no need to import `node-fetch`; `@types/node` v22 provides the types
- Article body extraction: use `jsdom` + `@mozilla/readability` (both CJS-compatible, no dynamic import workaround needed)
- `RawNewsItem` uses `url` (optional), `publishedAt` (ISO string), and `score` (optional number) — not `link`/`pubDate`
- Ingestion modules live in `src/ingestion/` and export a single `fetch*(): Promise<RawNewsItem[]>` function
- For RSS ingestion with `rss-parser`: use `item.isoDate` first, fall back to `new Date(item.pubDate).toISOString()`; content comes from `item.content ?? item.contentSnippet ?? item.summary`; map `item.link` → `url`
- Pipeline stages live in `src/stages/` and export a `run*()` function; `src/index.ts` is the entry point that calls the first stage
- `artifactDir(date?)` from `paths.ts` returns the output directory; call `fs.mkdir(dir, { recursive: true })` before writing to ensure it exists
- AI filter keywords are defined as a documented constant array in the stage file; checked with `String.prototype.includes` on lowercased combined title+content
- For LLM calls in stages: import `Anthropic` from `@anthropic-ai/sdk`; instantiate with `new Anthropic({ apiKey: config.anthropicApiKey })`; use `client.messages.create()` with `model: 'claude-sonnet-4-5'`
- Use `/\bai\b/` regex to detect standalone "AI" word without false positives from substrings like "rain" or "fail"
- Keyword classifiers should have STRONG (multi-word, unambiguous) and WEAK (single-word, potentially ambiguous) arrays; check strong first, then regex for standalone terms, then weak
- `CleanedNewsItem` requires non-null `content: string` and `wordCount: number` — use `item.content ?? ''` and `split(/\s+/).filter(Boolean).length` for items with null content
- Filter log entries have shape `{ id: string, title: string, source: string, reason: 'duplicate' | 'not_ai_related' | 'llm_excluded' }` — generate `id` as `item-{index}` since `RawNewsItem` has no id field
- `StructuredNewsItemSchema` in `src/schema.ts` is the Zod single source of truth for `StructuredNewsItem`; re-exported from `types.ts` for backward compat; when using the type within `types.ts` itself, add a separate `import type { StructuredNewsItem }` because a `export type { X }` re-export does not put `X` in local scope
- `CleanedNewsItem` includes `score?: number` (preserved from `RawNewsItem`) — needed by the structured extraction stage to map HN score → `impact_level`
- `StructuredNewsItemSchema` includes `impact_level: z.enum(['high', 'mid', 'low'])` — added in US-007 to support scoring

---

## [2026-05-31] - US-001
- Implemented full TypeScript/Node.js project scaffold from scratch (empty directory)
- Created `package.json` with deps: `@anthropic-ai/sdk`, `node-fetch`, `rss-parser`, `zod`; devDeps: `typescript`, `tsx`, `@types/node`
- Created `tsconfig.json` with strict mode, `Node16` module/moduleResolution, ES2022 target
- Created `src/types.ts` exporting `RawNewsItem`, `CleanedNewsItem`, `StructuredNewsItem`, `DailyReport`
- Created `src/config.ts` with lazy `requireEnv` getter — throws descriptive error if `ANTHROPIC_API_KEY` is missing
- Created `src/util/logger.ts` with `createLogger(stage)` factory producing stage-tagged timestamped output
- Created `src/util/paths.ts` producing dated paths under `output/{date}/`
- `npx tsc --noEmit` passes with zero errors
- Files changed: `package.json`, `package-lock.json`, `tsconfig.json`, `src/types.ts`, `src/config.ts`, `src/util/logger.ts`, `src/util/paths.ts`
- **Learnings for future iterations:**
  - Node16 moduleResolution requires `.js` extensions in relative imports even for `.ts` source files
  - The project starts from a completely empty directory — no prior structure exists
  - `node-fetch` v3 is ESM-only; future stages consuming it need `"type": "module"` or use dynamic import if staying CJS
  - `rss-parser` works with CommonJS; no extra config needed
---

## [2026-05-31] - US-002
- Created `src/ingestion/hackernews.ts` exporting `fetchHackerNews(): Promise<RawNewsItem[]>`
- Fetches top 30 HN story IDs from `/v0/topstories.json`, then fetches each item
- Article body extraction: native `fetch` to download HTML, `jsdom` to parse DOM, `@mozilla/readability` to extract text
- If item has `text` field → use directly as content; if `url` → fetch article; otherwise `content = null`
- Per-item errors (item fetch or article fetch) are caught, logged via `logger.warn`, and the item is skipped
- Updated `src/types.ts`: renamed `link` → `url` (optional), `pubDate` → `publishedAt`, `content?: string` → `content: string | null`, added optional `score?: number`; updated `CleanedNewsItem` and `StructuredNewsItem` to match
- Added `jsdom`, `@mozilla/readability` to dependencies; `@types/jsdom` to devDependencies
- Files changed: `src/ingestion/hackernews.ts` (new), `src/types.ts`, `package.json`, `package-lock.json`
- **Learnings for future iterations:**
  - Native `fetch` is available globally in Node 18+ — no import needed, and `@types/node` v22 types it correctly
  - `AbortSignal.timeout(ms)` is the clean way to add per-request timeouts without manual AbortController wiring
  - `jsdom` + `@mozilla/readability` are CJS-compatible and import cleanly under Node16 module resolution
  - `@mozilla/readability` ships its own TypeScript types; `jsdom` needs `@types/jsdom` as a separate devDep
  - `Promise.allSettled` is the right primitive for fan-out batch work where individual failures should not abort the batch
  - The `RawNewsItem` type was changed from `link`/`pubDate` → `url`/`publishedAt` to match the HN acceptance criteria; future RSS ingestion must map `rss-parser`'s `link`/`pubDate` fields accordingly
---

## [2026-05-31] - US-003
- Created `src/ingestion/qbitai.ts` exporting `fetchQbitAI(): Promise<RawNewsItem[]>`
- Fetches `https://www.qbitai.com/feed` using `rss-parser` with a 15s timeout and custom User-Agent
- Content mapped from `item.content ?? item.contentSnippet ?? item.summary ?? null`
- `publishedAt` uses `item.isoDate` if present, otherwise parses `item.pubDate` with `new Date().toISOString()`
- Top-level feed fetch errors are caught, logged, and return `[]` (no crash)
- Per-item errors are caught, logged, and the item is skipped
- Files changed: `src/ingestion/qbitai.ts` (new)
- **Learnings for future iterations:**
  - `rss-parser` accepts a `timeout` (ms) option in the constructor — no need for AbortSignal wiring
  - `item.isoDate` is the cleanest date field from rss-parser when available (already ISO); fall back to `new Date(item.pubDate)`
  - `item.content` vs `item.contentSnippet` vs `item.summary` — different feeds populate different fields; try all three in order
  - Feed-level failure (network error, bad XML) should return empty array, not throw — keeps the pipeline running
---

## [2026-05-31] - US-004
- Created `src/stages/rawExtract.ts` exporting `runRawExtract(date?: Date): Promise<RawNewsItem[]>`
- Calls `fetchHackerNews()` and `fetchQbitAI()` in parallel with `Promise.all`
- Defines `AI_KEYWORDS` array (English + Chinese terms) with inline comments documenting each group
- `isAIRelated` checks lowercased title+content against all keywords using `String.includes`
- Logs per-source fetched counts, per-source kept counts (with denominator), and total kept/total fetched
- Creates output directory with `fs.mkdir(dir, { recursive: true })` before writing
- Writes filtered array to `output/{date}/raw_{date}.json` using `artifactPath`
- Created `src/index.ts` as minimal pipeline entry point (runs `runRawExtract`)
- Files changed: `src/stages/rawExtract.ts` (new), `src/index.ts` (new)
- **Learnings for future iterations:**
  - `artifactDir` and `artifactPath` both accept an optional `Date` — pass the same `Date` instance to keep directory and filename in sync
  - `fs.mkdir` with `recursive: true` is idempotent — safe to call on every run
  - `Promise.all` (not `allSettled`) is appropriate here since ingestion functions already handle their own errors and return `[]` on failure
  - Source name in `RawNewsItem.source` differs between modules: HackerNews uses `'HackerNews'`, QbitAI uses `'qbitai'` — match exactly when filtering by source
---

## [2026-05-31] - US-005
- Created `src/stages/dataClean.ts` exporting `runDataClean(date?: Date): Promise<CleanedNewsItem[]>`
- Reads `raw_{date}.json`, de-duplicates by normalized title (lowercase + whitespace-collapsed) and URL
- Keyword classifier: STRONG_AI_KEYWORDS (unambiguous multi-word terms) → `clearly_ai`; `/\bai\b/` regex + WEAK_AI_KEYWORDS → `borderline`; no match → `clearly_not_ai`
- `clearly_not_ai` items filtered with reason `"not_ai_related"`; `clearly_ai` items kept immediately
- `borderline` items batched into a single `claude-sonnet-4-5` call via `client.messages.create()`; prompt requests JSON array of `{ id, keep }` objects
- LLM failure (network error or invalid JSON) falls back to keeping all borderline items and logs a warning
- Writes `cleaned_{date}.json` (kept items as `CleanedNewsItem` with `wordCount`) and `filter_{date}.json` (all excluded items as `{ id, title, source, reason }`)
- Updated `src/index.ts` to pass the same `Date` instance to both `runRawExtract` and `runDataClean` to keep artifact paths in sync
- Files changed: `src/stages/dataClean.ts` (new), `src/index.ts` (updated)
- **Learnings for future iterations:**
  - `\bai\b` regex correctly matches standalone "AI" without false positives from words containing "ai" as a substring (rain, fail, main, etc.)
  - Always guard LLM JSON parsing in a try/catch — models occasionally return markdown-fenced code blocks or extra explanation text despite instructions
  - Pass the same `Date` instance through the entire pipeline run so all stages write to the same output directory
  - `config.anthropicApiKey` is a lazy getter — accessing it throws if the env var is missing; only access it in the function body (not at module level) so tests or dry runs without the key don't fail at import time
---

## [2026-05-31] - US-006
- Created `src/schema.ts` exporting `StructuredNewsItemSchema` (Zod) and `StructuredNewsItem` type via `z.infer`
- Updated `src/types.ts` to re-export `StructuredNewsItem` from `./schema.js` and import it locally for use in `DailyReport`
- Files changed: `src/schema.ts` (new), `src/types.ts` (updated)
- **Learnings for future iterations:**
  - When re-exporting a type with `export type { X } from '...'`, it is NOT in scope within the same file — add a separate `import type { X }` if you need to use it locally (e.g., in another interface in the same file)
  - `zod` was already in `dependencies` from US-001 scaffolding, no install needed
  - Keep `StructuredNewsItem` re-exported from `types.ts` so existing imports (`from './types.js'`) continue to work without churn
---

## [2026-05-31] - US-007
- Created `src/stages/structuredExtract.ts` exporting `runStructuredExtract(date?: Date): Promise<OutputRecord[]>`
- Reads `cleaned_{date}.json`, splits items into chunks of 3 with `chunkArray` helper
- For each chunk, builds a prompt with `buildPrompt()` and calls `claude-sonnet-4-5` via `client.messages.create()`
- Prompt includes full schema spec, impact_level rules (HN: score-based thresholds >=250/>=100; qbitai: content heuristics)
- `extractChunk()` parses JSON response, validates each item against `StructuredNewsItemSchema.safeParse()`, falls back to `{ __extraction_error: true, title, source }` on per-item validation failure
- Per-chunk network/parse failures: caught at the loop level, all items in the chunk emitted as error sentinels, `chunksErrored` counter incremented
- Writes combined array to `output/{date}/structured_{date}.json`
- Logs: `chunks_processed`, `items_produced`, `chunks_errored`
- Updated `src/schema.ts` to add `impact_level: z.enum(['high', 'mid', 'low'])`
- Updated `src/types.ts` to add `score?: number` to `CleanedNewsItem`
- Updated `src/stages/dataClean.ts` to preserve `score` from `RawNewsItem` when building `CleanedNewsItem`
- Updated `src/index.ts` to call `runStructuredExtract` as the third pipeline stage
- Files changed: `src/stages/structuredExtract.ts` (new), `src/schema.ts`, `src/types.ts`, `src/stages/dataClean.ts`, `src/index.ts`
- **Learnings for future iterations:**
  - `__extraction_error: true` sentinel records coexist in the output array with valid `StructuredNewsItem` objects — downstream stages must check for `'__extraction_error' in record`
  - `StructuredNewsItemSchema.safeParse()` is ideal for per-item validation within a chunk; a failed item gets a sentinel instead of aborting the whole chunk
  - `score` must be carried from `RawNewsItem` → `CleanedNewsItem` (added field) to support score-based impact_level mapping; qbitai items have `score = undefined`
  - Use `as const` on `true` in `{ __extraction_error: true as const }` for proper TypeScript literal type narrowing
  - Large max_tokens (4096) needed for chunk extraction since each item produces a full structured object
---

## [2026-05-31] - US-008
- Created `src/stages/validateStructured.ts` exporting `runValidateStructured(date?: Date): Promise<void>`
- Reads `structured_{date}.json` (which may contain both valid `StructuredNewsItem` and `ErrorRecord` sentinels)
- Reads `cleaned_{date}.json` to build a `Map<source::normalizedTitle, CleanedNewsItem>` for retry lookup
- First pass: error sentinels skip directly to retry; other records are validated with `StructuredNewsItemSchema.safeParse()`
- Retry: calls a single-item LLM prompt (`claude-sonnet-4-5`, max_tokens 2048) for each invalid record's original `CleanedNewsItem`
- Records that pass (first pass or retry) go to `validated_{date}.json`; failures go to `invalidated_{date}.json` with `{ zodErrors, originalItem }`
- Error sentinels produce `zodErrors: null` in the invalidated output (no schema validation was done originally)
- Schema-invalid records attach the first-pass `.flatten()` Zod error to the invalidated output
- Logs `valid_first_pass`, `recovered_after_retry`, `finally_invalid` counts
- Updated `src/index.ts` to call `runValidateStructured` as the fourth pipeline stage
- Files changed: `src/stages/validateStructured.ts` (new), `src/index.ts` (updated)
- **Learnings for future iterations:**
  - Error sentinels (`__extraction_error: true`) coexist with valid records in `structured_{date}.json`; check `'__extraction_error' in record` before schema validation
  - Lookup key strategy: `source::normalizedTitle` (lowercase + trimmed) for matching cleaned items to structured records; titles are consistent across stages
  - Single-item LLM retry prompt returns a JSON object (not array); keep `max_tokens` smaller (2048) vs chunk extraction (4096)
  - Use a local `FlattenedZodError` type alias (`{ formErrors: string[]; fieldErrors: Record<string, string[] | undefined> }`) instead of complex generic inference from `z.ZodError.flatten()` return type
  - `StructuredNewsItemSchema` is already imported in `structuredExtract.ts`; no changes needed to `schema.ts` for this story
---

## [2026-05-31] - US-009
- Created `src/stages/generateReport.ts` exporting `runGenerateReport(date?: Date): Promise<DailyReport>`
- Reads `validated_{date}.json` (assigns sequential `evidence_id` like `e001`, `e002`, ...) and `cleaned_{date}.json` (for sourceExcerpt context)
- Builds a source-context map from cleaned items keyed by `source::normalizedTitle` to enrich evidence sent to Claude
- Calls `claude-sonnet-4-5` with max_tokens 8192; prompt instructs model to return a JSON report with `executiveSummary`, `topEvents`, `trends`, `alerts`, `categorySummaries` — every analytical claim must include `evidence_ids`
- LLM JSON parse failure falls back to empty skeleton fields (no crash) and logs a warning
- Merges LLM output with `date`, `generatedAt`, `totalArticles`, and `evidenceIndex` (mapping evidence_id → title/source/url)
- Writes to `output/{date}/report_{date}.json`
- Updated `src/types.ts`: replaced old `DailyReport` (topStories/categorySummaries:string/executiveSummary:string) with new evidence-backed structure (`EvidencedClaim`, `EvidenceIndex`, `topEvents`, `trends`, `alerts`, `categorySummaries: Record<string, EvidencedClaim>`)
- Updated `src/index.ts` to call `runGenerateReport` as the fifth pipeline stage
- Files changed: `src/stages/generateReport.ts` (new), `src/types.ts` (updated), `src/index.ts` (updated)
- **Learnings for future iterations:**
  - Evidence IDs are generated at runtime as `e{padStart(3,'0')}` index strings — the `evidenceIndex` array in the report maps them back to title/source/url for human readability
  - Use max_tokens 8192 for full-report generation since the output can be large (multiple sections, multiple items)
  - Building a `source::normalizedTitle` map over cleaned items lets you enrich validated records with original sourceExcerpt without needing a separate ID field on cleaned items
  - The LLM report sections are merged onto a base object (date/generatedAt/totalArticles/evidenceIndex) so structural metadata is always present even if Claude fails
---

## [2026-05-31] - US-010
- Created `src/stages/generateDashboard.ts` exporting `runGenerateDashboard(date?: Date): Promise<void>`
- Reads `validated_{date}.json` (StructuredNewsItem[])
- Aggregates: word frequency from category names (5x weight) + key point words (1x), filtered by stop words; region counts via SOURCE_REGION_MAP (HackerNews→North America, qbitai→China/Asia); sentiment counts (positive/negative/neutral); top events sorted by impact_level then relevanceScore
- Generates self-contained `index_{date}.html` with: wordcloud (wordcloud@1.2.2 CDN) on `id="chart-tags"`, region pie on `id="chart-region"`, sentiment bar on `id="chart-sentiment"`, event cards in `id="cards-top-events"`
- All card text set via `textContent` (XSS-safe); data embedded as `var dashData = ${safeJson}` with `<` replaced by `<` to prevent `</script>` injection
- Script tags use `<\/script>` in template literals so the TS string contains the safe HTML `<\/script>` form
- Updated `src/index.ts` to call `runGenerateDashboard` as the sixth pipeline stage
- Files changed: `src/stages/generateDashboard.ts` (new), `src/index.ts` (updated)
- **Learnings for future iterations:**
  - `config.outputDir` is set at module load time (not lazily) — cannot override with env vars after import
  - `<\/script>` in a TypeScript template literal produces `</script>` in output (backslash before `/` is not a recognized escape). To emit the literal `<\/` in HTML (which browsers parse as safe), write `<\\/` in the TS source — but simpler is to just use a variable: `const CLOSE = '</script>'` concatenated from two parts
  - Actually `<\/script>` in a template literal in TypeScript IS safe because `\/` === `/` in JS strings, so the HTML gets `</script>` properly; the concern is only when that text would appear inside a `<script>` block in the HTML — not in regular attributes or CDN script tags
  - wordcloud2.js canvas must have `width`/`height` attributes set (not just CSS) before calling `WordCloud()` — set them in the inline script using `canvas.parentElement.clientWidth`
  - `StructuredNewsItem` has no explicit `tags` or `region` fields; use `category` + `keyPoints` words for the wordcloud, and `source` as a region proxy
---

## [2026-05-31] - US-011
- Created `src/stages/generateFinalReport.ts` exporting `runGenerateFinalReport(date?: Date): Promise<void>`
- Uses `jsdom` to parse `index_{date}.html` and extract chart elements by `id` (no re-implementation of chart code)
- `extractFromDashboard()` extracts: CDN script URLs, dashboard `<style>` content, full inline rendering script, and `outerHTML` of each chart container using `doc.getElementById(id)` + `.closest('.chart-card')`
- `renderReportHtml()` combines DailyReport sections (executive summary, in-depth events, trends, alerts, category summaries, evidence index) with embedded chart HTML
- Section-to-chart mapping: trends → `chart-tags` wordcloud; in-depth → `cards-top-events`; alerts → `chart-region` + `chart-sentiment`
- Evidence IDs rendered as clickable `<a href="#ev-{id}">` badges; evidence index section has `id="ev-{evidence_id}"` on each row for anchor navigation
- Closing `</script>` tag split as `'</' + 'script>'` variable to avoid TS template literal parsing issues
- Updated `src/index.ts` to call `runGenerateFinalReport` as the seventh pipeline stage
- Files changed: `src/stages/generateFinalReport.ts` (new), `src/index.ts` (updated)
- **Learnings for future iterations:**
  - jsdom is already a dependency (from US-002); no install needed for HTML parsing in later stages
  - `el.closest('.chart-card')` walks up the DOM to find the enclosing card wrapper — works on both canvas and div elements
  - Splitting the closing tag `'</' + 'script>'` avoids the template-literal issue without using backslash tricks
  - The dashboard's inline rendering script already guards all chart creation with `if (element && ...)` null checks — reusing it as-is means only charts whose container elements are present in the page will render
  - Evidence badge anchor links (`href="#ev-{id}"`) require `id` attributes on the evidence table rows for in-page navigation to work
---

## [2026-05-31] - US-012
- Created `pipeline.js` at repo root — requires `tsx/cjs` to enable TypeScript imports, then requires `./src/index.ts`
- Updated `src/index.ts` to add `runStage(name, fn)` wrapper that logs "Starting stage: X", "Stage complete: X", and on failure logs the error and rethrows as `Stage "X" failed: <message>` for clear identification
- Updated `src/index.ts` to log `Pipeline starting` (with ISO date) and `Pipeline complete`
- Created `README.md` documenting setup (`ANTHROPIC_API_KEY`), install (`npm install`), and run (`node pipeline.js`)
- Verified: `node pipeline.js` starts correctly, logs pipeline/stage start messages, and executes stages
- Files changed: `pipeline.js` (new), `src/index.ts` (updated), `README.md` (new)
- **Learnings for future iterations:**
  - `require('tsx/cjs')` in a `.js` CJS file registers tsx as a module hook; subsequent `require('./src/file.ts')` calls are handled by tsx (`.js` extension imports in TS resolve to the corresponding `.ts` source file)
  - No subprocess spawning needed — tsx/cjs hook works in-process, no performance overhead of child_process.spawn
  - The `runStage<T>` generic wrapper pattern keeps index.ts clean: one line per stage with automatic start/complete/error logging
  - The pipeline.js file is plain CommonJS (no `"type": "module"` in package.json); tsx/cjs works correctly in this context
---
