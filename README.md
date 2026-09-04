# Mason Johnson RC — Site + Live Timing

Flat layout — every file lives at the repo root, except
`.github/workflows/`, which GitHub requires to be exactly there (it
won't recognize workflow files anywhere else — this is a hard
platform rule, not a choice).

## Files

- `index.html` — the site
- `1up.png`, `hobbywing.png`, `jconcepts.png`, `team-associated.png` —
  sponsor/gear logos shown in the header strip
- `live-timing.json` — the current timing data, overwritten
  automatically (see below)
- `core.js` — LiveRC fetch/parse logic
- `update-timing.mjs` — runs `core.js` and writes `live-timing.json`
- `.github/workflows/update-timing.yml` — runs `update-timing.mjs` on
  a schedule

## How live timing works

1. The GitHub Actions workflow runs roughly every 15 minutes.
2. It runs `node update-timing.mjs`, which fetches LiveRC's practice
   page for today, finds Mason's most recent session, and overwrites
   `live-timing.json`.
3. It commits that file back to the repo.
4. `index.html` fetches `live-timing.json` like any other static
   file — GitHub Pages serves it, no server involved anywhere.

## Setting it up

1. Push this repo to GitHub.
2. **Settings → Pages** — enable Pages (source: the branch you
   pushed, root folder).
3. **Settings → Actions → General → Workflow permissions** — set to
   "Read and write permissions." The workflow needs this to commit
   `live-timing.json` back to the repo.
4. Done. The workflow runs on its own from here. You can also trigger
   it manually from the **Actions** tab → "Update Live Timing" → "Run
   workflow."

## Honest limitations

- **Not real-time.** Reflects LiveRC's page data on a ~15-minute
  refresh, not live telemetry during a run — LiveRC doesn't expose a
  public real-time API.
- **GitHub's cron isn't exact** — can run a few minutes late under load.
- **60-day auto-disable.** GitHub disables scheduled workflows after
  60 days of no other repo activity. A commit or manual run
  re-enables it.
- **Untested selectors.** `core.js`'s parser was built from LiveRC
  pages read through a text tool, not raw HTML inspection — should
  work, but check the Actions run logs if `live-timing.json` ever
  looks wrong after a run.

## Adding the driver photo later

In `index.html`, search for `PHOTO SWAP` — there's a comment marking
exactly where to swap the placeholder for `<img src="mason.jpg">` once
you have the photo. Just drop `mason.jpg` at the repo root alongside
everything else.
