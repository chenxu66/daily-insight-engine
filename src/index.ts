import { runRawExtract } from './stages/rawExtract.js';
import { runDataClean } from './stages/dataClean.js';
import { runStructuredExtract } from './stages/structuredExtract.js';
import { runValidateStructured } from './stages/validateStructured.js';
import { runGenerateReport } from './stages/generateReport.js';
import { runGenerateDashboard } from './stages/generateDashboard.js';
import { runGenerateFinalReport } from './stages/generateFinalReport.js';
import { createLogger } from './util/logger.js';

const logger = createLogger('pipeline');

async function runStage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  logger.info(`Starting stage: ${name}`);
  try {
    const result = await fn();
    logger.info(`Stage complete: ${name}`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Stage failed: ${name}`, { error: message });
    throw new Error(`Stage "${name}" failed: ${message}`);
  }
}

async function main() {
  const date = new Date();
  logger.info('Pipeline starting', { date: date.toISOString() });

  await runStage('rawExtract', () => runRawExtract(date));
  await runStage('dataClean', () => runDataClean(date));
  await runStage('structuredExtract', () => runStructuredExtract(date));
  await runStage('validateStructured', () => runValidateStructured(date));
  await runStage('generateReport', () => runGenerateReport(date));
  await runStage('generateDashboard', () => runGenerateDashboard(date));
  await runStage('generateFinalReport', () => runGenerateFinalReport(date));

  logger.info('Pipeline complete');
}

main().catch((err) => {
  console.error('Pipeline failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
