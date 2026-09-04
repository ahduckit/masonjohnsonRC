# Mason Johnson RC — Site + Live Timing (GitHub-only setup)

This setup needs **no separate hosting service** for live timing —
just GitHub Pages (serves the site) and GitHub Actions (keeps the
timing data current). No Koyeb, no Vercel, no PHP host required.

## How it works

1. `.github/workflows/update-timing.yml` runs every 15 minutes on
   GitHub's own servers.
2. It runs `scripts/update-timing.mjs`, which fetches LiveRC's
   practice page for today, finds Mason's most recent session, and
   writes the result to `data/live-timing.json`.
3. It commits that file back to the repo.
4. The site (`index.html`) just fetches `data/live-timing.json` like
   any other static file — GitHub Pages serves it, no server involved.

## Setting it up

1. Push this whole folder to a GitHub repo.
2. In the repo's **Settings → Pages**, enable Pages (source: the
   branch you pushed to, root folder).
3. In the repo's **Settings → Actions → General**, confirm "Read and
   write permissions" is enabled for the `GITHUB_TOKEN` (needed for
   the workflow to commit the updated JSON file back — this is usually
   on by default for new repos, but worth checking).
4. That's it. The workflow starts running on its 15-minute schedule
   automatically. You can also trigger it manually any time from the
   repo's **Actions** tab → "Update Live Timing" → "Run workflow".

## Honest limitations

- **Not real-time.** This reflects LiveRC's own page data, refreshed
  every 15 minutes by GitHub's schedule — not sub-second telemetry
  during an active run. LiveRC doesn't expose a public real-time API.
- **GitHub's cron isn't exact.** Scheduled workflows can run a few
  minutes late under GitHub's load — treat "every 15 minutes" as
  "roughly every 15 minutes."
- **60-day auto-disable.** GitHub automatically disables scheduled
  workflows on repos with no other activity for 60 days. A commit or
  a manual "Run workflow" click re-enables it — worth knowing if the
  data ever looks stale.
- **Untested selectors.** The parser in `scripts/core.js` was built
  from LiveRC pages read through a text-extraction tool, not raw HTML
  inspection, so field extraction should work but might need a small
  regex tweak once it's run against real traffic. Check the Actions
  tab's run logs, or manually run `node scripts/update-timing.mjs`
  locally, to see what it actually pulled.

## If you want closer-to-live updates later

This same `scripts/core.js` logic also powers two other deployment
options, if 15-minute-delayed data isn't fast enough:
- `relay-node/` — a real server (deploy on Koyeb, free, allows
  outbound requests)
- `relay-php/` — a PHP version for a standard PHP host (not
  InfinityFree — see that folder's README for why)

Swapping to either just means changing `RELAY_URL` in `index.html`
from `'data/live-timing.json'` to that server's URL — nothing else
about the site changes.
