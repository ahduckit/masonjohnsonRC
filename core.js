// core.js
//
// Shared logic for the Mason Johnson RC live-timing relay. Both the
// standalone Express server (server.js, for Koyeb/any Node host) and
// the Vercel serverless function (../relay/api/live-timing.js) can
// import this so the parsing logic lives in exactly one place.
//
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

// The whole pipeline: fetch -> match -> parse -> build the JSON
// payload the site's fetchTimingData() expects.
export async function getLiveTimingPayload(debug = false) {
  try {
    const date = todayInTrackTZ();
    const url = `https://${TRACK_SLUG}.liverc.com/practice/?p=session_list&d=${date}`;
    const html = await fetchHtml(url);
    const matchedRows = extractMatchingRows(html);

    if (matchedRows.length === 0) {
      return {
        ok: true,
        trackStatus: 'off',
        trackStatusLabel: 'Standby',
        lastLap: null,
        rows: [],
        asOf: new Date().toISOString(),
        note: `No sessions found for ${DRIVER_NAME} on ${date}.`,
        ...(debug ? { debugUrl: url } : {})
      };
    }

    // LiveRC's practice list is observed newest-first.
    const latest = parseSessionRow(matchedRows[0]);
    const age = minutesAgo(latest.time, date);
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
      sessionTime: latest.time,
      date,
      asOf: new Date().toISOString(),
      source: 'practice'
    };

    if (debug) {
      payload.debug = { matchedRowCount: matchedRows.length, matchedRows, parsedLatest: latest, sourceUrl: url };
    }

    return payload;
  } catch (err) {
    return {
      ok: false,
      trackStatus: 'off',
      trackStatusLabel: 'Standby',
      lastLap: null,
      rows: [],
      error: err.message,
      asOf: new Date().toISOString()
    };
  }
}
