import { runRawExtract } from './stages/rawExtract.js';
import { runDataClean } from './stages/dataClean.js';

async function main() {
  const date = new Date();
  await runRawExtract(date);
  await runDataClean(date);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
