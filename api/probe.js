// Temporary diagnostic: fetches a sample from each candidate data source and
// reports what came back, so V2 pages are built on real data shapes.
// Safe to delete once V2 is built.

const U = process.env.UPSTREAM || 'https://ncaa-api.henrygd.me';

const SOURCES = {
  // ncaa-api (JSON)
  rank_uscho: U + '/rankings/icehockey-men/d1/uschocom',
  rank_usah_ncaa: U + '/rankings/icehockey-men/d1/usa-today/usa-hockey-magazine',
  standings_ncaa: U + '/standings/icehockey-men/d1',
  stats_points: U + '/stats/icehockey-men/d1/current/individual/99',
  stats_team_scoring: U + '/stats/icehockey-men/d1/current/team/101',
  schools: U + '/schools-index',
  // HTML sources
  usah_poll: 'https://www.ahcahockey.com/polls.php',
  chi_teams: 'https://www.collegehockeyinc.com/mens-teams-and-conferences/',
  chi_scoring: 'https://www.collegehockeyinc.com/conferences/national/natplayer27.php',
  chi_goalies: 'https://www.collegehockeyinc.com/conferences/national/natgoalie27.php',
  chi_team_leaders: 'https://www.collegehockeyinc.com/conferences/national/natteam27.php',
  uscho_npi: 'https://www.uscho.com/rankings/npi/d-i-men/',
  uscho_standings: 'https://www.uscho.com/standings/division-i-men/',
  chn_npi: 'https://www.collegehockeynews.com/ratings/npi.php',
  chn_standings: 'https://www.collegehockeynews.com/standings/',
};

function stripHtml(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(tr|p|div|h\d|li)>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n').trim();
}

function summarizeJson(j) {
  const keys = j && typeof j === 'object' ? Object.keys(j) : [];
  return { type: 'json', keys, sample: JSON.stringify(j).slice(0, 2500) };
}

function summarizeHtml(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const firstTable = (html.match(/<table[\s\S]*?<\/table>/i) || [])[0] || '';
  const links = Array.from(html.matchAll(/href="([^"]+)"/gi)).map(m => m[1])
    .filter(h => /stand|roster|team|npi|stats|natplayer|natgoalie|conference/i.test(h)).slice(0, 40);
  return {
    type: 'html', title: title.trim().slice(0, 200), tables: (html.match(/<table/gi) || []).length,
    firstTable: stripHtml(firstTable).slice(0, 1800), links,
  };
}

async function grab(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Barnburner personal app)', accept: '*/*' }, signal: AbortSignal.timeout(9000) });
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    let body;
    if (/json/.test(ct) || /^[\[{]/.test(text.trim())) { try { body = summarizeJson(JSON.parse(text)); } catch (e) { body = { type: 'text', sample: text.slice(0, 1500) }; } }
    else body = summarizeHtml(text);
    return { url, status: r.status, contentType: ct, bytes: text.length, ...body };
  } catch (e) {
    return { url, error: String(e && e.message || e) };
  }
}

async function gameSamples(dateParts) {
  const sb = await fetch(`${U}/scoreboard/icehockey-men/d1/${dateParts}/all-conf`, { signal: AbortSignal.timeout(9000) }).then(r => r.json()).catch(() => null);
  const games = (sb && sb.games) || [];
  const final = games.map(g => g.game || g).find(g => g.gameState === 'final') || (games[0] && (games[0].game || games[0]));
  if (!final) return { scoreboard: 'no games', date: dateParts };
  const id = final.gameID || String(final.url || '').replace(/\D/g, '');
  const out = { date: dateParts, gameCount: games.length, firstGameFull: final };
  const parts = ['', '/boxscore', '/scoring-summary', '/team-stats', '/play-by-play'];
  const res = await Promise.all(parts.map(p => grab(`${U}/game/${id}${p}`)));
  parts.forEach((p, i) => { out['game' + (p || '/info')] = res[i]; });
  return out;
}

export async function GET(request) {
  const url = new URL(request.url);
  const only = url.searchParams.get('only');
  const names = Object.keys(SOURCES).filter(n => !only || only.split(',').includes(n));
  const results = await Promise.all(names.map(n => grab(SOURCES[n])));
  const out = { generatedAt: new Date().toISOString(), sources: {} };
  names.forEach((n, i) => { out.sources[n] = results[i]; });
  if (!only || only.includes('game')) out.game = await gameSamples(url.searchParams.get('date') || '2026/11/07');
  return new Response(JSON.stringify(out, null, 1), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
