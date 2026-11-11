# Barnburner

A personal live college hockey app (D-I men) for a handful of friends. It's a phone web app on Vercel; code lives on GitHub, and every push to `main` redeploys it.

## Screens
- **Scores**: daily games by conference, a date picker, "Ranked by" NPI / USCHO / USA Hockey, records, and followed teams pinned on top. Live games refresh every 30 s.
- **Game**: Summary (scoring blocks, line score with shots, team stat bars), Box (skaters and goalies), Plays (play-by-play, newest first). A "Raw feed" link shows exactly what the source sent.
- **Standings**: each conference's points, conference record and overall record, with NPI rank.
- **NPI**: NPI table with both poll ranks alongside, plus full USCHO and USA Hockey polls.
- **Stats**: national skater and goalie leaders, filterable by conference and sortable.
- **Teams**: every D-I team by conference with follow stars. A team page shows record, ranks, roster with stats, and team stats with D-I ranks.

## Where the data comes from
| Data | Source | Cached |
|---|---|---|
| Scores, box scores, play-by-play, logos | NCAA (via ncaa-api) | 15–20 s |
| NPI | College Hockey News (follows the NCAA's published method) | 30 min |
| USCHO poll | NCAA (via ncaa-api) | 30 min |
| USA Hockey poll | American Hockey Coaches Association | 30 min |
| Standings, player and team stats | College Hockey Inc. | 10–15 min |

Everything is fetched by `api/` on Vercel and cached at its CDN, so the sources see one visitor no matter how many phones are open. These are public pages, not official APIs: if one changes its layout, that screen shows an error until its parser is updated.

## Files
- `index.html`: the whole app (no build step)
- `api/proxy.js`: relay for NCAA game data and logos (retries once on rate limits)
- `api/data.js`: rankings, standings and stats from the pages above, as JSON
- `vercel.json`: routes

Add `?demo=1` to the URL to see the app with sample data.

## Known gaps
- Team rosters list players who have played this season (from the stats tables), with no jersey numbers.
- The "Team site" button uses a web search to open the school's site.
- No team schedule tab yet.

## V3
- Team page: Roster (school roster with jersey numbers + headshots, merged with season stats), Schedule (College Hockey Inc. national schedule), Team stats with D-I ranks.
- Official team site link for all 62 programs (`SITES` in api/data.js).
- Game feed: penalties in Summary and Plays; box score PEN shown as count (minutes).
- `/api/data?type=roster&team=<key>` (12h cache) and `type=schedule` (15 min).
- 8 schools whose roster pages don't parse fall back to numbers from the latest NCAA box score (no photos).
