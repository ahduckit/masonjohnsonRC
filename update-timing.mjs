// update-timing.mjs
//
// Run by the GitHub Actions workflow (.github/workflows/update-timing.yml)
// on a schedule. Fetches LiveRC, extracts Mason's latest session (via
// core.js — the same tested parsing logic), and writes the result to
// live-timing.json, right alongside index.html.
//
// GitHub Pages then serves that JSON file like any other static
// asset — no server process running anywhere. The site's
// fetchTimingData() just fetches that file's URL.
//
// PERSONAL BEST TRACKING: the site shows a genuine all-time personal
// record (site.hero "Best Lap" + the bio), not just "fastest lap in the
// last 3 sessions" — those aren't the same thing if he hasn't beaten his
// PR recently. Since we only fetch a short lookback window each run
// (not his full history), the PR is carried forward from the previous
// live-timing.json and only replaced if a genuinely faster lap shows up
// in this run's fetch. It only ever improves, never regresses just
// because an old faster session fell outside this run's lookback.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getLiveTimingPayload } from './core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, 'live-timing.json');

// Load whatever personal best is already on record, if any.
let previousBest = null;
try {
  const prev = JSON.parse(await readFile(outPath, 'utf-8'));
  if (prev.personalBestLap) {
    const value = parseFloat(prev.personalBestLap);
    if (!isNaN(value)) {
      previousBest = {
        value,
        display: prev.personalBestLap,
        laps: prev.personalBestSessionLaps,
        date: prev.personalBestDate,
        time: prev.personalBestTime
      };
    }
  }
} catch {
  // No previous file yet (first run ever), or it wasn't valid JSON —
  // either way, just start fresh with no prior record.
}

const payload = await getLiveTimingPayload(false);

// Find the fastest lap among the sessions this run actually fetched.
let candidateBest = null;
for (const s of payload.recentSessions || []) {
  const value = parseFloat(s.fastestLap);
  if (!isNaN(value) && (candidateBest === null || value < candidateBest.value)) {
    candidateBest = { value, display: s.fastestLap, laps: s.laps, date: s.date, time: s.time };
  }
}

// Ratchet: keep the previous record unless this run found something
// genuinely faster (or there was no previous record at all).
let personalBest = previousBest;
if (candidateBest && (!previousBest || candidateBest.value < previousBest.value)) {
  personalBest = candidateBest;
}

if (personalBest) {
  payload.personalBestLap = personalBest.display; // e.g. "24.904s" — original string, not reconstructed from the float, so formatting is never lost
  payload.personalBestSessionLaps = personalBest.laps;
  payload.personalBestDate = personalBest.date;
  payload.personalBestTime = personalBest.time;
}

await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');

console.log(
  `Wrote ${outPath} — trackStatus: ${payload.trackStatus}, lastLap: ${payload.lastLap ?? 'none'}, personalBest: ${payload.personalBestLap ?? 'none'}`
);
