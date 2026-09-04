// scripts/update-timing.mjs
//
// Run by the GitHub Actions workflow (.github/workflows/update-timing.yml)
// on a schedule. Fetches LiveRC, extracts Mason's latest session (via
// core.js — the same tested logic used by the Koyeb/Vercel relay
// versions), and writes the result to data/live-timing.json.
//
// GitHub Pages then serves that JSON file like any other static
// asset — no server process running anywhere. The site's
// fetchTimingData() just fetches that file's URL.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getLiveTimingPayload } from './core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'data', 'live-timing.json');

const payload = await getLiveTimingPayload(false);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log(
  `Wrote ${outPath} — trackStatus: ${payload.trackStatus}, lastLap: ${payload.lastLap ?? 'none'}`
);
