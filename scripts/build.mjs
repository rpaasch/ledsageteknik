import { build } from '../lib/build.mjs';

build().catch((e) => {
  console.error('\nBuild fejlede:', e.message);
  process.exit(1);
});
