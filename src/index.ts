import { runRawExtract } from './stages/rawExtract.js';
import { runDataClean } from './stages/dataClean.js';
import { runStructuredExtract } from './stages/structuredExtract.js';
import { runValidateStructured } from './stages/validateStructured.js';
import { runGenerateReport } from './stages/generateReport.js';

async function main() {
  const date = new Date();
  await runRawExtract(date);
  await runDataClean(date);
  await runStructuredExtract(date);
  await runValidateStructured(date);
  await runGenerateReport(date);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
