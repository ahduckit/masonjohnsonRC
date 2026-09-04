// core.js
//
// Shared logic for the Mason Johnson RC live-timing pipeline. Used by
// update-timing.mjs (run on a schedule by GitHub Actions).
// WHAT THIS DOES: fetches LiveRC's practice session list for today,
// server-side (browsers can't reach LiveRC directly — it blocks
// cross-origin requests), and looks for the tracked driver's most
// recent session.
// WHAT THIS DOES NOT DO: give sub-second, mid-run telemetry. LiveRC
// doesn't expose a public real-time API. This reflects LiveRC's own
// page data, which updates once a session is logged — not lap by lap.
//
// UNTESTED SELECTORS: built by reading LiveRC pages through a
// text-extraction tool, not raw HTML inspection — table markup wasn't
// visible. The parser below uses regex pattern-matching on row text
// rather than fixed CSS selectors (more resilient to markup changes,
// but may still need a tweak). Call with debug=true to get the raw
// matched row text back for troubleshooting.

export const TRACK_SLUG = 'coyotehobbiesraceway';
export const DRIVER_NAME = 'MASON JOHNSON';
export const TRANSPONDER = '7208001';
export const TRACK_TIMEZONE = 'America/Los_Angeles';

// How recent a session must be to count as "on track right now".
export const ACTIVE_WINDOW_MINUTES = 20;

export function todayInTrackTZ() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TRACK_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

export async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MasonJohnsonRC-Relay/1.0)' }
  });
  if (!res.ok) throw new Error(`LiveRC returned ${res.status} for ${url}`);
  return res.text();
}

// Pull every <tr>...</tr> block as raw text (tags replaced with a
// space, not deleted, so adjacent cells don't merge together) and
// keep the ones mentioning our driver/transponder.
export function extractMatchingRows(html) {
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const rowHtml = m[1];
    const rowText = rowHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (rowText.toUpperCase().includes(DRIVER_NAME) || rowText.includes(TRANSPONDER)) {
      rows.push(rowText);
    }
  }
  return rows;
}

// Best-effort field extraction from a matched row's plain text.
// Expected shape (from observed LiveRC practice tables): a time-of-day,
// a lap count, a session length, a fastest lap, an average lap — in
// that rough order, as decimal seconds like "27.229".
export function parseSessionRow(rowText) {
  const timeMatch = rowText.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s?[APap][Mm]\b/);
  const decimals = rowText.match(/\b\d{1,3}\.\d{2,3}\b/g) || [];
  const smallInts = rowText.match(/(?<![\d:.])\b\d{1,3}\b(?!\d*[:.])/g) || [];

  return {
    time: timeMatch ? timeMatch[0] : null,
    laps: smallInts.length ? parseInt(smallInts[0], 10) : null,
    fastestLap: decimals.length > 0 ? decimals[0] : null,
    avgLap: decimals.length > 1 ? decimals[1] : null,
    raw: rowText
  };
}

export function subtractDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

export function minutesAgo(timeOfDayStr, dateStr) {
  if (!timeOfDayStr) return null;
  try {
    const dt = new Date(`${dateStr} ${timeOfDayStr}`);
    if (isNaN(dt.getTime())) return null;
    return (Date.now() - dt.getTime()) / 60000;
  } catch {
    return null;
  }
}

// Walks backward day by day from today (in track-local time) collecting
// the driver's sessions, until it has `maxSessions` or has looked back
// `maxDaysBack` days. Stops early once enough sessions are found, so
// the common case (he practiced recently) is just 1-2 requests, not a
// full 14-day scan every run.
export async function getRecentSessions(maxSessions = 3, maxDaysBack = 14) {
  const sessions = [];
  const errors = [];
  let daysBack = 0;

  while (sessions.length < maxSessions && daysBack <= maxDaysBack) {
    const date = subtractDays(todayInTrackTZ(), daysBack);
    const url = `https://${TRACK_SLUG}.liverc.com/practice/?p=session_list&d=${date}`;
    try {
      const html = await fetchHtml(url);
      const matchedRows = extractMatchingRows(html);
      // LiveRC's practice list is observed newest-first within a day.
      for (const rowText of matchedRows) {
        if (sessions.length >= maxSessions) break;
        sessions.push({ date, ...parseSessionRow(rowText) });
      }
    } catch (err) {
      errors.push(`${date}: ${err.message}`);
    }
    daysBack++;
  }

  return { sessions, daysChecked: daysBack, errors };
}

// The whole pipeline: look back for recent sessions -> build the JSON
// payload the site's fetchTimingData() expects.
export async function getLiveTimingPayload(debug = false) {
  try {
    const { sessions, daysChecked, errors } = await getRecentSessions(3, 14);

    if (sessions.length === 0) {
      return {
        ok: true,
        trackStatus: 'off',
        trackStatusLabel: 'Standby',
        lastLap: null,
        rows: [],
        recentSessions: [],
        asOf: new Date().toISOString(),
        note: `No sessions found for ${DRIVER_NAME} in the last ${daysChecked} day(s).`,
        ...(debug ? { debugErrors: errors } : {})
      };
    }

    // sessions[0] is his single most recent session across whichever
    // day it landed on.
    const latest = sessions[0];
    const age = minutesAgo(latest.time, latest.date);
    const isActive = age !== null && age <= ACTIVE_WINDOW_MINUTES;

    const payload = {
      ok: true,
      trackStatus: isActive ? 'green' : 'off',
      trackStatusLabel: isActive ? 'On Track' : 'Standby',
      lastLap: latest.fastestLap ? `${latest.fastestLap}s` : null,
      rows: [
        {
          pos: '—',
          driver: 'Mason Johnson',
          cls: 'Rookie',
          laps: latest.laps ?? '—',
          bestLap: latest.fastestLap ? `${latest.fastestLap}s` : '—',
          status: isActive ? 'On Track' : 'Session Logged'
        }
      ],
      // Up to 3 most recent sessions (may span multiple days), for
      // the site's Practice Breakdown table.
      recentSessions: sessions.map(s => ({
        date: s.date,
        time: s.time,
        laps: s.laps,
        fastestLap: s.fastestLap ? `${s.fastestLap}s` : '—',
        avgLap: s.avgLap ? `${s.avgLap}s` : '—'
      })),
      sessionTime: latest.time,
      date: latest.date,
      asOf: new Date().toISOString(),
      source: 'practice'
    };

    if (debug) {
      payload.debug = { sessionCount: sessions.length, daysChecked, sessions, errors };
    }

    return payload;
  } catch (err) {
    return {
      ok: false,
      trackStatus: 'off',
      trackStatusLabel: 'Standby',
      lastLap: null,
      rows: [],
      recentSessions: [],
      error: err.message,
      asOf: new Date().toISOString()
    };
  }
}
