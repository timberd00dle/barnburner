# Barnburner — V1

A personal live college hockey scoreboard (D-I men). It's a phone web app on Vercel, with code on GitHub.

**What V1 does**
- Daily scores grouped by conference, with previous/next day and a calendar picker
- Live games refresh every 30 s; other games on today's date every 5 min. Refreshing pauses when the app is in the background.
- Box score page with scoring blocks (period/time, scorer, assists, PPG/SHG/EN tag, running score), a line score, team stats bars and player stats
- Team logos (fall back to the abbreviation if a logo is missing)
- Follow teams (★ on a game page) → they're pinned to the top of Scores (saved on each phone)
- Light/dark mode, and "Updated Xs ago" so you can tell a stale feed from a slow game
- A **Raw feed** tab on every game, showing exactly what the data source sent

**Not in V1:** standings, NPI, poll toggle, league stats, team pages, news, and the cross-check against school live stats. Those come in V2.

## How it works

```
phones ──> Vercel (/api/proxy, CDN-cached 15–20 s) ──> ncaa-api ──> ncaa.com
```

## Deploy

1. Push this folder to a new GitHub repo (e.g. `barnburner`).
2. In Vercel: **Add New → Project →** import the repo. Framework preset: **Other**. Leave the build and output settings empty, then click Deploy.
3. Open the URL on your phone, then use Share → **Add to Home Screen**.

Every push to `main` redeploys automatically.

To preview with sample data and no live feed, add `?demo=1` to the URL.

**Optional environment variables** (Vercel → Settings → Environment Variables):
- `UPSTREAM` — point at your own self-hosted ncaa-api if the public demo server gets flaky (`docker run -p 3000:3000 henrygd/ncaa-api`)
- `NCAA_HEADER_KEY` — only if your self-hosted copy requires a key

## Free-tier math

Five phones polling every 30 s during a four-hour game night is about 2,400 requests. Most of them are answered from Vercel's CDN cache, so this is well within the Hobby plan.

## First live night: please check

The scores list uses well-documented feed fields. The box score parsing hasn't been tested against a live hockey game yet. If a box score looks off, open **Raw feed** on that game and send a screenshot or copy.

## Files

- `index.html` — the whole app (HTML/CSS/JS, no build step)
- `api/proxy.js` — data relay + caching
- `vercel.json` — routes `/api/*` to the relay
