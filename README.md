# Daily Insight Engine

An automated pipeline that fetches AI news from Hacker News and QbitAI, filters and structures it using Claude, and generates a daily HTML report with analytics.

## Setup

Set the `ANTHROPIC_API_KEY` environment variable before running:

```sh
export ANTHROPIC_API_KEY=your-api-key-here
```

## Install

```sh
npm install
```

## Run

```sh
node pipeline.js
```

The pipeline runs these stages in order:

1. **rawExtract** — fetches news from Hacker News and QbitAI, filters for AI relevance
2. **dataClean** — de-duplicates items and uses Claude to verify borderline AI relevance
3. **structuredExtract** — uses Claude to extract structured fields (category, key points, etc.)
4. **validateStructured** — validates extracted records against the schema; retries failures with Claude
5. **generateReport** — uses Claude to produce an evidence-backed analytical report
6. **generateDashboard** — generates an interactive HTML visualization dashboard
7. **generateFinalReport** — combines report text and dashboard charts into a final HTML report

Output files are written to `output/{YYYY-MM-DD}/`:

| File | Description |
|------|-------------|
| `raw_{date}.json` | Raw news items after initial keyword filtering |
| `cleaned_{date}.json` | De-duplicated, AI-verified items with word counts |
| `structured_{date}.json` | LLM-extracted structured records |
| `validated_{date}.json` | Schema-validated final records |
| `invalidated_{date}.json` | Records that failed validation after retry |
| `filter_{date}.json` | Items excluded during cleaning with reasons |
| `report_{date}.json` | Analytical report with evidence IDs |
| `index_{date}.html` | Interactive visualization dashboard |
| `report_{date}.html` | Final integrated HTML report |
