// Temporary diagnostic #2: exact data shapes (key trees + table cells), fetched
// one at a time so the data source's rate limit isn't hit. Delete after V2.

const U = process.env.UPSTREAM || 'https://ncaa-api.henrygd.me';
const CHI = 'https://www.collegehockeyinc.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function shape(v, depth) {
  depth = depth || 0;
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.length ? ['len=' + v.length, shape(v[0], depth + 1)] : [];
  if (typeof v === 'object') {
    if (depth > 7) return '{…}';
    const o = {};
    Object.keys(v).forEach(k => { o[k] = shape(v[k], depth + 1); });
    return o;
  }
  const s = String(v);
  return s.length > 40 ? s.slice(0, 40) + '…' : v;
}

function cells(html, maxTables, maxRows) {
  const tables = (html.match(/<table[\s\S]*?<\/table>/gi) || []).slice(0, maxTables);
  return tables.map(t => {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []);
    return {
      rowCount: rows.length,
      rows: rows.slice(0, maxRows).map(r => (r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [])
        .map(c => c.replace(/<a [^>]*href="([^"]+)"[^>]*>/i, '[$1] ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())),
    };
  });
}

async function get(url, as) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Barnburner personal app)' }, signal: AbortSignal.timeout(9000) });
    const text = await r.text();
    if (as === 'json') { let j = null; try { j = JSON.parse(text); } catch (e) {} return { status: r.status, shape: j ? shape(j) : text.slice(0, 200) }; }
    const links = Array.from(text.matchAll(/href="([^"#]+)"/gi)).map(m => m[1]).filter((h, i, a) => a.indexOf(h) === i);
    return { status: r.status, tables: cells(text, 2, 4), links: as === 'links' ? links.filter(h => !/\.(css|js|png|jpg|svg|ico)(\?|$)/i.test(h)).slice(0, 250) : undefined };
  } catch (e) { return { error: String(e && e.message || e) }; }
}

export async function GET() {
  const gid = '6643179'; // Providence 8, UConn 1 on 2026-11-07
  const jobs = [
    ['scoring', U + '/game/' + gid + '/scoring-summary', 'json'],
    ['boxscore', U + '/game/' + gid + '/boxscore', 'json'],
    ['teamstats', U + '/game/' + gid + '/team-stats', 'json'],
    ['pbp', U + '/game/' + gid + '/play-by-play', 'json'],
    ['ncaa_stats_points', U + '/stats/icehockey-men/d1/current/individual/99', 'json'],
    ['uscho_rank', U + '/rankings/icehockey-men/d1/uschocom', 'json'],
    ['usah_poll', 'https://www.ahcahockey.com/polls.php', 'html'],
    ['chi_scoring', CHI + '/conferences/national/natplayer27.php', 'html'],
    ['chi_goalies', CHI + '/conferences/national/natgoalie27.php', 'html'],
    ['chi_team', CHI + '/conferences/national/natteam27.php', 'html'],
    ['chi_teams_links', CHI + '/mens-teams-and-conferences/', 'links'],
    ['chi_men_he', CHI + '/men/hockey-east/', 'links'],
  ];
  const out = { generatedAt: new Date().toISOString() };
  for (const [name, url, as] of jobs) {
    out[name] = Object.assign({ url }, await get(url, as));
    await sleep(350);
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
