import fs from 'fs/promises';
import type { StructuredNewsItem } from '../types.js';
import { createLogger } from '../util/logger.js';
import { artifactDir, artifactPath } from '../util/paths.js';

const logger = createLogger('generateDashboard');

const SOURCE_REGION_MAP: Record<string, string> = {
  HackerNews: 'North America',
  qbitai: 'China / Asia',
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'this', 'that', 'these', 'those', 'it', 'its',
  'as', 'not', 'no', 'so', 'each', 'than', 'then', 'when', 'where', 'which',
  'who', 'how', 'all', 'any', 'can', 'into', 'through', 'during', 'before',
  'after', 'up', 'down', 'out', 'over', 'once', 'what', 'their', 'they',
  'them', 'our', 'we', 'you', 'he', 'she', 'her', 'new', 'about', 'more',
  'also', 'one', 'two', 'three', 'use', 'using', 'used', 'model', 'models',
  'says', 'said', 'ai', 'data', 'based', 'some', 'between', 'across',
]);

interface TopEvent {
  title: string;
  summary: string;
  sentiment: string;
  impact_level: string;
  category: string;
  url?: string;
}

interface DashboardData {
  wordList: [string, number][];
  regionLabels: string[];
  regionData: number[];
  sentimentData: [number, number, number];
  topEvents: TopEvent[];
}

function buildDashboardData(items: StructuredNewsItem[]): DashboardData {
  // Word frequency: categories (5x weight) + key point words (1x)
  const wordFreq: Record<string, number> = {};

  for (const item of items) {
    const catWords = item.category
      .toLowerCase()
      .split(/[\s/&,+]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    for (const w of catWords) {
      wordFreq[w] = (wordFreq[w] ?? 0) + 5;
    }

    for (const point of item.keyPoints) {
      const words = point
        .toLowerCase()
        .split(/[\s\-–—,.:;()[\]"'/\\]+/)
        .filter((w) => w.length > 4 && !STOP_WORDS.has(w) && /^[a-z]/.test(w));
      for (const w of words) {
        wordFreq[w] = (wordFreq[w] ?? 0) + 1;
      }
    }
  }

  const entries = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60);
  const maxFreq = entries[0]?.[1] ?? 1;
  const wordList: [string, number][] = entries.map(([text, freq]) => [
    text,
    Math.round(12 + (freq / maxFreq) * 68),
  ]);

  // Region distribution (source → region)
  const regionCounts: Record<string, number> = {};
  for (const item of items) {
    const region = SOURCE_REGION_MAP[item.source] ?? item.source;
    regionCounts[region] = (regionCounts[region] ?? 0) + 1;
  }

  // Sentiment distribution
  const sc = { positive: 0, negative: 0, neutral: 0 };
  for (const item of items) sc[item.sentiment]++;

  // Top events: high impact first, then by relevance score
  const impactOrder: Record<string, number> = { high: 0, mid: 1, low: 2 };
  const topEvents: TopEvent[] = [...items]
    .sort((a, b) => {
      const diff = impactOrder[a.impact_level] - impactOrder[b.impact_level];
      return diff !== 0 ? diff : b.relevanceScore - a.relevanceScore;
    })
    .slice(0, 8)
    .map((item) => ({
      title: item.title,
      summary: item.summary,
      sentiment: item.sentiment,
      impact_level: item.impact_level,
      category: item.category,
      url: item.url,
    }));

  return {
    wordList,
    regionLabels: Object.keys(regionCounts),
    regionData: Object.values(regionCounts),
    sentimentData: [sc.positive, sc.negative, sc.neutral],
    topEvents,
  };
}

function renderHtml(dateStr: string, totalItems: number, dashData: DashboardData): string {
  // Escape < to prevent </script> in data from closing the script tag
  const safeJson = JSON.stringify(dashData).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily AI Insight — ${dateStr}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/wordcloud@1.2.2/src/wordcloud2.js"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f0f2f5;
      color: #1a1a2e;
      margin: 0;
      padding: 20px;
    }
    header {
      text-align: center;
      padding: 24px 0 16px;
    }
    header h1 { font-size: 2rem; margin: 0; color: #16213e; }
    header p { color: #666; margin: 6px 0 0; font-size: 0.95rem; }
    .charts-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      max-width: 1200px;
      margin: 20px auto;
    }
    .chart-card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .chart-card.full-width { grid-column: 1 / -1; }
    .chart-card h2 {
      font-size: 0.8rem;
      font-weight: 700;
      color: #888;
      margin: 0 0 16px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    #chart-tags { display: block; width: 100%; height: 300px; }
    #chart-region, #chart-sentiment { max-height: 280px; }
    .events-section {
      max-width: 1200px;
      margin: 0 auto 40px;
    }
    .events-section > h2 {
      font-size: 0.8rem;
      font-weight: 700;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 0 0 16px;
    }
    #cards-top-events {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .event-card {
      background: white;
      border-radius: 12px;
      padding: 18px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      display: flex;
      flex-direction: column;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 6px;
    }
    .card-header h3 {
      font-size: 0.92rem;
      font-weight: 600;
      margin: 0;
      color: #16213e;
      flex: 1;
      line-height: 1.4;
    }
    .badge {
      font-size: 0.68rem;
      padding: 2px 8px;
      border-radius: 20px;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
      align-self: flex-start;
    }
    .badge-positive { background: #d4edda; color: #155724; }
    .badge-negative { background: #f8d7da; color: #721c24; }
    .badge-neutral  { background: #e2e3e5; color: #383d41; }
    .badge-high { background: #fff3cd; color: #856404; }
    .badge-mid  { background: #cce5ff; color: #004085; }
    .badge-low  { background: #d1ecf1; color: #0c5460; }
    .card-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }
    .card-category {
      font-size: 0.72rem;
      color: #888;
    }
    .card-summary {
      font-size: 0.84rem;
      color: #555;
      line-height: 1.55;
      margin: 0;
      flex: 1;
    }
    .card-link {
      font-size: 0.78rem;
      color: #4361ee;
      margin-top: 12px;
      display: inline-block;
      text-decoration: none;
    }
    .card-link:hover { text-decoration: underline; }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #999;
      font-size: 1.1rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>Daily AI Insight</h1>
    <p>${dateStr} &middot; ${totalItems} article${totalItems !== 1 ? 's' : ''} analyzed</p>
  </header>

  ${totalItems === 0 ? '<div class="empty-state">No articles available for this date.</div>' : `
  <div class="charts-grid">
    <div class="chart-card full-width">
      <h2>Tags &amp; Industries</h2>
      <canvas id="chart-tags"></canvas>
    </div>
    <div class="chart-card">
      <h2>Region Distribution</h2>
      <canvas id="chart-region"></canvas>
    </div>
    <div class="chart-card">
      <h2>Sentiment Distribution</h2>
      <canvas id="chart-sentiment"></canvas>
    </div>
  </div>

  <div class="events-section">
    <h2>Top Events</h2>
    <div id="cards-top-events"></div>
  </div>
  `}

  <script>
    var dashData = ${safeJson};

    // --- Wordcloud ---
    var wcCanvas = document.getElementById('chart-tags');
    if (wcCanvas && dashData.wordList.length > 0) {
      wcCanvas.width = wcCanvas.parentElement.clientWidth || 800;
      wcCanvas.height = 300;
      WordCloud(wcCanvas, {
        list: dashData.wordList,
        gridSize: 10,
        weightFactor: 1,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: function() {
          var palette = ['#4361ee', '#3f37c9', '#7209b7', '#f72585', '#4cc9f0', '#4895ef'];
          return palette[Math.floor(Math.random() * palette.length)];
        },
        backgroundColor: 'white',
        rotateRatio: 0.25,
        minSize: 10,
      });
    }

    // --- Region pie chart ---
    var regionCtx = document.getElementById('chart-region');
    if (regionCtx) {
      new Chart(regionCtx, {
        type: 'pie',
        data: {
          labels: dashData.regionLabels,
          datasets: [{
            data: dashData.regionData,
            backgroundColor: ['#4361ee', '#f72585', '#4cc9f0', '#7209b7', '#3f37c9'],
            borderWidth: 2,
            borderColor: 'white',
          }],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
          },
        },
      });
    }

    // --- Sentiment bar chart ---
    var sentimentCtx = document.getElementById('chart-sentiment');
    if (sentimentCtx) {
      new Chart(sentimentCtx, {
        type: 'bar',
        data: {
          labels: ['Positive', 'Negative', 'Neutral'],
          datasets: [{
            label: 'Articles',
            data: dashData.sentimentData,
            backgroundColor: ['#d4edda', '#f8d7da', '#e2e3e5'],
            borderColor: ['#28a745', '#dc3545', '#6c757d'],
            borderWidth: 2,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } },
          },
          plugins: { legend: { display: false } },
        },
      });
    }

    // --- Top event cards ---
    var container = document.getElementById('cards-top-events');
    if (container) {
      dashData.topEvents.forEach(function(ev) {
        var card = document.createElement('div');
        card.className = 'event-card';

        var header = document.createElement('div');
        header.className = 'card-header';

        var h3 = document.createElement('h3');
        h3.textContent = ev.title;
        header.appendChild(h3);

        var sentBadge = document.createElement('span');
        sentBadge.className = 'badge badge-' + ev.sentiment;
        sentBadge.textContent = ev.sentiment;
        header.appendChild(sentBadge);
        card.appendChild(header);

        var meta = document.createElement('div');
        meta.className = 'card-meta';
        var catSpan = document.createElement('span');
        catSpan.className = 'card-category';
        catSpan.textContent = ev.category;
        meta.appendChild(catSpan);
        var impactBadge = document.createElement('span');
        impactBadge.className = 'badge badge-' + ev.impact_level;
        impactBadge.textContent = ev.impact_level;
        meta.appendChild(impactBadge);
        card.appendChild(meta);

        var summary = document.createElement('p');
        summary.className = 'card-summary';
        summary.textContent = ev.summary;
        card.appendChild(summary);

        if (ev.url) {
          var link = document.createElement('a');
          link.href = ev.url;
          link.className = 'card-link';
          link.textContent = 'Read more →';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          card.appendChild(link);
        }

        container.appendChild(card);
      });
    }
  <\/script>
</body>
</html>`;
}

export async function runGenerateDashboard(date: Date = new Date()): Promise<void> {
  const dateStr = date.toISOString().slice(0, 10);
  logger.info(`Generating dashboard for ${dateStr}`);

  const validatedPath = artifactPath(`validated_${dateStr}.json`, date);
  const raw = await fs.readFile(validatedPath, 'utf-8');
  const items: StructuredNewsItem[] = JSON.parse(raw);

  logger.info(`Loaded ${items.length} validated items`);

  const dashData = buildDashboardData(items);
  const html = renderHtml(dateStr, items.length, dashData);

  const dir = artifactDir(date);
  await fs.mkdir(dir, { recursive: true });

  const outPath = artifactPath(`index_${dateStr}.html`, date);
  await fs.writeFile(outPath, html, 'utf-8');

  logger.info(`Wrote dashboard to ${outPath}`);
  logger.info(
    `Summary: words=${dashData.wordList.length}, regions=${dashData.regionLabels.length}, topEvents=${dashData.topEvents.length}`,
  );
}
