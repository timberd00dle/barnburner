// Temporary diagnostic #3: conference standings + team page/roster layouts. Delete after V2.
const CHI = 'https://collegehockeyinc.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cells(html, maxTables, maxRows) {
  const tables = (html.match(/<table[\s\S]*?<\/table>/gi) || []).slice(0, maxTables);
  return tables.map(t => {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []);
    return { rowCount: rows.length, rows: rows.slice(0, maxRows).map(r => (r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [])
      .map(c => c.replace(/<a [^>]*href="([^"]+)"[^>]*>/i, '[$1] ').replace(/<img [^>]*src="([^"]+)"[^>]*>/i, '{img:$1} ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())) };
  });
}
async function get(url, withLinks) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Barnburner personal app)' }, signal: AbortSignal.timeout(9000) });
    const text = await r.text();
    const out = { status: r.status, tables: cells(text, 3, 4) };
    if (withLinks) out.links = Array.from(text.matchAll(/href="([^"#]+)"/gi)).map(m => m[1]).filter((h, i, a) => a.indexOf(h) === i && /\/teams\/|roster|stats|sched|standings/i.test(h)).slice(0, 60);
    return out;
  } catch (e) { return { error: String(e && e.message || e) }; }
}
export async function GET() {
  const confs = ['nchc', 'big-ten', 'hockey-east', 'ecac', 'ecac-hockey', 'ccha', 'atlantic-hockey', 'aha', 'atlantic-hockey-america', 'independents', 'independent'];
  const out = { generatedAt: new Date().toISOString(), standings: {} };
  for (const c of confs) { out.standings[c] = await get(`${CHI}/conferences/${c}/standings27.php`); await sleep(300); }
  out.team_denver = await get(`${CHI}/teams/denver/index.php`, true);
  await sleep(300);
  const rosterLink = (out.team_denver.links || []).find(h => /roster/i.test(h));
  if (rosterLink) out.roster_denver = Object.assign({ url: rosterLink }, await get(rosterLink.startsWith('http') ? rosterLink : CHI + rosterLink));
  await sleep(300);
  const statsLink = (out.team_denver.links || []).find(h => /stats/i.test(h) && /denver/i.test(h));
  if (statsLink) out.stats_denver = Object.assign({ url: statsLink }, await get(statsLink.startsWith('http') ? statsLink : CHI + statsLink));
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
