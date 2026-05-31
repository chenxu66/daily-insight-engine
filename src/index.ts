import { runRawExtract } from './stages/rawExtract.js';

runRawExtract().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
