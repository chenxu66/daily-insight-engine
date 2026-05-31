import fs from 'fs/promises';
import { JSDOM } from 'jsdom';
import type { DailyReport } from '../types.js';
import { createLogger } from '../util/logger.js';
import { artifactDir, artifactPath } from '../util/paths.js';

const logger = createLogger('generateFinalReport');

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface DashboardExtract {
  cdnScripts: string[];
  styleContent: string;
  inlineScript: string;
  chartTagsHtml: string;
  chartRegionHtml: string;
  chartSentimentHtml: string;
  cardsTopEventsHtml: string;
}

function extractFromDashboard(html: string): DashboardExtract {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const cdnScripts: string[] = [];
  doc.querySelectorAll('script[src]').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) cdnScripts.push(src);
  });

  const styleContent = doc.querySelector('style')?.innerHTML ?? '';

  const inlineScript = [...doc.querySelectorAll('script:not([src])')]
    .map((el) => el.textContent ?? '')
    .join('\n');

  function getChartCardHtml(id: string): string {
    const el = doc.getElementById(id);
    if (!el) return `<div id="${id}"></div>`;
    const card = el.closest('.chart-card');
    return (card ?? el).outerHTML;
  }

  function getElementHtml(id: string): string {
    const el = doc.getElementById(id);
    return el ? el.outerHTML : `<div id="${id}"></div>`;
  }

  return {
    cdnScripts,
    styleContent,
    inlineScript,
    chartTagsHtml: getChartCardHtml('chart-tags'),
    chartRegionHtml: getChartCardHtml('chart-region'),
    chartSentimentHtml: getChartCardHtml('chart-sentiment'),
    cardsTopEventsHtml: getElementHtml('cards-top-events'),
  };
}

function renderReportHtml(dateStr: string, report: DailyReport, dash: DashboardExtract): string {
  const closeScript = '</' + 'script>';

  const cdnTags = dash.cdnScripts
    .map((src) => `  <script src="${escapeHtml(src)}">${closeScript}`)
    .join('\n');

  function evidenceBadges(ids: string[]): string {
    return ids.map((id) => `<a href="#ev-${id}" class="ev-badge">${id}</a>`).join('');
  }

  function renderParagraphs(text: string, trailingBadges: string): string {
    const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paras.length === 0) return `<p>${trailingBadges}</p>`;
    return paras
      .map((p, i) =>
        `<p>${escapeHtml(p)}${i === paras.length - 1 ? (trailingBadges ? ' ' + trailingBadges : '') : ''}</p>`,
      )
      .join('');
  }

  // Executive summary
  const summarySection = `
  <section class="report-section" id="section-summary">
    <h2>Executive Summary</h2>
    <div class="report-content">
      ${renderParagraphs(report.executiveSummary.text, evidenceBadges(report.executiveSummary.evidence_ids))}
    </div>
  </section>`;

  // In-depth analysis (top events) + embedded event cards
  const topEventsContent = report.topEvents
    .map(
      (ev) => `
    <div class="report-event">
      <h3>${escapeHtml(ev.title)}</h3>
      ${renderParagraphs(ev.analysis.text, evidenceBadges(ev.analysis.evidence_ids))}
    </div>`,
    )
    .join('');

  const inDepthSection = `
  <section class="report-section" id="section-events">
    <h2>In-Depth Analysis</h2>
    <div class="report-content">${topEventsContent}</div>
    <div class="embedded-charts-label">Top Events at a Glance</div>
    ${dash.cardsTopEventsHtml}
  </section>`;

  // Trends + chart-tags (tag/industry wordcloud)
  const trendsContent = report.trends
    .map(
      (t, i) => `
    <div class="report-trend">
      <span class="trend-num">${i + 1}</span>
      <div>${renderParagraphs(t.text, evidenceBadges(t.evidence_ids))}</div>
    </div>`,
    )
    .join('');

  const trendsSection = `
  <section class="report-section" id="section-trends">
    <h2>Emerging Trends</h2>
    <div class="report-content">${trendsContent}</div>
    ${dash.chartTagsHtml}
  </section>`;

  // Risks & opportunities + region + sentiment charts
  const alertsContent = report.alerts
    .map(
      (a) => `
    <div class="report-alert alert-${a.type}">
      <span class="alert-tag">${a.type === 'risk' ? 'Risk' : 'Opportunity'}</span>
      <p>${escapeHtml(a.description)} ${evidenceBadges(a.evidence_ids)}</p>
    </div>`,
    )
    .join('');

  const alertsSection = `
  <section class="report-section" id="section-alerts">
    <h2>Risks &amp; Opportunities</h2>
    <div class="report-content">${alertsContent}</div>
    <div class="charts-grid">
      ${dash.chartRegionHtml}
      ${dash.chartSentimentHtml}
    </div>
  </section>`;

  // Category summaries
  const categoriesContent = Object.entries(report.categorySummaries)
    .map(
      ([cat, claim]) => `
    <div class="report-category">
      <h3>${escapeHtml(cat)}</h3>
      ${renderParagraphs(claim.text, evidenceBadges(claim.evidence_ids))}
    </div>`,
    )
    .join('');

  const categoriesSection = `
  <section class="report-section" id="section-categories">
    <h2>Category Summaries</h2>
    <div class="report-content">${categoriesContent}</div>
  </section>`;

  // Evidence index
  const evidenceRows = report.evidenceIndex
    .map((ev) => {
      const titleCell = ev.url
        ? `<a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.title)}</a>`
        : escapeHtml(ev.title);
      return `    <tr id="ev-${ev.evidence_id}">
      <td class="ev-id">${ev.evidence_id}</td>
      <td>${titleCell}</td>
      <td>${escapeHtml(ev.source)}</td>
    </tr>`;
    })
    .join('\n');

  const evidenceSection = `
  <section class="report-section" id="section-evidence">
    <h2>Evidence Index</h2>
    <table class="evidence-table">
      <thead>
        <tr><th>ID</th><th>Title</th><th>Source</th></tr>
      </thead>
      <tbody>
${evidenceRows}
      </tbody>
    </table>
  </section>`;

  const totalStr = report.totalArticles;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily AI Report — ${dateStr}</title>
${cdnTags}
  <style>
${dash.styleContent}
    /* Report layout */
    .report-section {
      max-width: 1200px;
      margin: 0 auto 32px;
      background: white;
      border-radius: 12px;
      padding: 32px 36px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .report-section h2 {
      font-size: 1.25rem;
      font-weight: 700;
      color: #16213e;
      margin: 0 0 22px;
      padding-bottom: 12px;
      border-bottom: 2px solid #f0f2f5;
    }
    .report-content p {
      font-size: 0.95rem;
      line-height: 1.75;
      color: #333;
      margin: 0 0 14px;
    }
    .report-content p:last-child { margin-bottom: 0; }
    .ev-badge {
      display: inline-block;
      font-size: 0.67rem;
      font-weight: 700;
      background: #e8eeff;
      color: #3f37c9;
      border-radius: 4px;
      padding: 1px 5px;
      margin-left: 3px;
      text-decoration: none;
      vertical-align: middle;
    }
    .ev-badge:hover { background: #d0d8ff; }
    .report-event {
      margin-bottom: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid #f0f2f5;
    }
    .report-event:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .report-event h3 { font-size: 1rem; font-weight: 600; color: #16213e; margin: 0 0 8px; }
    .embedded-charts-label {
      font-size: 0.8rem;
      font-weight: 700;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 28px 0 14px;
    }
    .report-trend {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 18px;
    }
    .trend-num {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      background: #4361ee;
      color: white;
      border-radius: 50%;
      font-size: 0.75rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: 2px;
    }
    .report-trend div p { margin: 0 0 8px; }
    .report-trend div p:last-child { margin: 0; }
    .report-alert {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;
    }
    .alert-tag {
      flex-shrink: 0;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 4px;
      white-space: nowrap;
      margin-top: 3px;
    }
    .alert-risk .alert-tag { background: #f8d7da; color: #721c24; }
    .alert-opportunity .alert-tag { background: #d4edda; color: #155724; }
    .report-alert p { margin: 0; font-size: 0.92rem; line-height: 1.65; color: #333; }
    .report-category { margin-bottom: 22px; }
    .report-category:last-child { margin-bottom: 0; }
    .report-category h3 {
      font-size: 0.9rem;
      font-weight: 700;
      color: #16213e;
      margin: 0 0 6px;
    }
    .report-category p { margin: 0; font-size: 0.9rem; line-height: 1.65; color: #555; }
    .evidence-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .evidence-table th {
      background: #f0f2f5;
      padding: 8px 12px;
      text-align: left;
      font-weight: 700;
      color: #555;
    }
    .evidence-table td {
      padding: 8px 12px;
      border-bottom: 1px solid #f0f2f5;
      vertical-align: top;
    }
    .evidence-table tr:last-child td { border-bottom: none; }
    .ev-id { font-weight: 700; color: #4361ee; white-space: nowrap; }
    .evidence-table a { color: #4361ee; text-decoration: none; }
    .evidence-table a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <h1>Daily AI Insight Report</h1>
    <p>${dateStr} &middot; ${totalStr} article${totalStr !== 1 ? 's' : ''} analyzed</p>
  </header>

  ${summarySection}
  ${inDepthSection}
  ${trendsSection}
  ${alertsSection}
  ${categoriesSection}
  ${evidenceSection}

  <script>
${dash.inlineScript}
  ${closeScript}
</body>
</html>`;
}

export async function runGenerateFinalReport(date: Date = new Date()): Promise<void> {
  const dateStr = date.toISOString().slice(0, 10);
  logger.info(`Generating final integrated report for ${dateStr}`);

  const reportJsonPath = artifactPath(`report_${dateStr}.json`, date);
  const dashboardHtmlPath = artifactPath(`index_${dateStr}.html`, date);

  const [reportJson, dashboardHtml] = await Promise.all([
    fs.readFile(reportJsonPath, 'utf-8'),
    fs.readFile(dashboardHtmlPath, 'utf-8'),
  ]);

  const report: DailyReport = JSON.parse(reportJson);
  const dash = extractFromDashboard(dashboardHtml);

  logger.info(
    `Loaded report: ${report.totalArticles} articles, ${report.evidenceIndex.length} evidence items`,
  );
  logger.info(
    `Dashboard extract: ${dash.cdnScripts.length} CDN scripts, inline script ${dash.inlineScript.length} chars`,
  );

  const html = renderReportHtml(dateStr, report, dash);

  const dir = artifactDir(date);
  await fs.mkdir(dir, { recursive: true });

  const outPath = artifactPath(`report_${dateStr}.html`, date);
  await fs.writeFile(outPath, html, 'utf-8');

  logger.info(`Wrote integrated report to ${outPath}`);
}
