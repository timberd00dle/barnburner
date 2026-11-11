// Barnburner data endpoint: turns the public sources into clean JSON.
//   /api/data?type=rankings   NPI (College Hockey News) + USCHO poll (NCAA) + USA Hockey poll (AHCA)
//   /api/data?type=standings  all six conference standings (College Hockey Inc.)
//   /api/data?type=stats      national skater, goalie and team stats (College Hockey Inc.)
//   /api/data?type=meta       school slugs for logos (NCAA)
// Each answer is cached on Vercel's CDN, so sources see one quiet visitor.

const NCAA = process.env.UPSTREAM || 'https://ncaa-api.henrygd.me';
const CHI = 'https://collegehockeyinc.com';
const CHN = 'https://www.collegehockeynews.com';
const UA = { 'user-agent': 'Mozilla/5.0 (Barnburner personal scoreboard)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// season code used by College Hockey Inc. pages: 2026-27 -> "27"
function seasonCode(d = new Date()) {
  const y = d.getUTCFullYear() + (d.getUTCMonth() >= 6 ? 1 : 0);
  return String(y).slice(-2);
}

async function text(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.text();
}
async function json(url) {
  let r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(9000) });
  if (r.status === 428 || r.status === 429) { await sleep(1200); r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(9000) }); }
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  return r.json();
}

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&dagger;|&Dagger;/g, '').replace(/&[a-z]+;/g, '').replace(/\s+/g, ' ').trim();
}
// Every table on a page -> array of rows -> array of {t: text, href}
function tables(html) {
  return (html.match(/<table[\s\S]*?<\/table>/gi) || []).map(t =>
    (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map(r =>
      (r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(c => {
        const href = (c.match(/href="([^"]+)"/i) || [])[1] || '';
        return { t: decode(c.replace(/<[^>]+>/g, ' ')), href };
      })));
}
const num = s => { const n = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n; };

// ---- rankings ---------------------------------------------------------
async function npi() {
  const html = await text(CHN + '/ratings/npi');
  const t = tables(html)[0] || [];
  const rows = [];
  t.forEach(r => {
    if (r.length < 6 || !/^\d+$/.test(r[0].t)) return;
    const flag = (r[1].t.match(/[*#]/) || [])[0] || '';
    rows.push({ rank: +r[0].t, team: r[1].t.replace(/[*#]/g, '').trim(), npi: num(r[2].t), record: r[3].t.replace(/\s*\(.*\)\s*/, ''),
      otRecord: (r[3].t.match(/\(([^)]*)\)/) || [])[1] || '', wtdWin: r[4].t, qwb: r[5].t, flag });
  });
  if (!rows.length) throw new Error('NPI table empty');
  return { source: 'College Hockey News', rows };
}
async function uscho() {
  const j = await json(NCAA + '/rankings/icehockey-men/d1/uschocom');
  const rows = (j.data || []).map(d => {
    const teamRaw = d['TEAM (1ST VOTES)'] || d.TEAM || d.SCHOOL || '';
    return { rank: num(d.RANK), team: teamRaw.replace(/\s*\(\d+\)\s*$/, '').trim(), firstVotes: num((teamRaw.match(/\((\d+)\)\s*$/) || [])[1]) || 0,
      record: d.RECORD || '', points: num(d.POINTS), previous: d.PREVIOUS || '' };
  }).filter(r => r.rank);
  return { source: 'USCHO.com', updated: j.updated || '', rows };
}
async function usaHockey() {
  const html = await text('https://www.ahcahockey.com/polls.php');
  const plain = decode(html.replace(/<[^>]+>/g, ' '));
  const date = (plain.match(/Men's College Hockey Poll\s+([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1] || '';
  const t = tables(html)[0] || [];
  const rows = [];
  t.forEach(r => {
    if (r.length < 4 || !/^T?-?\d+\.?$/.test(r[0].t)) return;
    const m = r[1].t.match(/^(.*?),\s*(\d+)(?:\s*\((\d+)\))?$/);
    rows.push({ rank: num(r[0].t.replace(/^T-?/, '')), tied: /^T/.test(r[0].t), team: m ? m[1] : r[1].t, points: m ? +m[2] : null, firstVotes: m && m[3] ? +m[3] : 0,
      previous: r[2].t, record: r[3].t });
  });
  if (!rows.length) throw new Error('USA Hockey poll table empty');
  return { source: 'USA Hockey / AHCA', updated: date, rows };
}

// ---- standings --------------------------------------------------------
const CONFS = [['NCHC', 'nchc'], ['Big Ten', 'big-ten'], ['Hockey East', 'hockey-east'], ['ECAC Hockey', 'ecac-hockey'], ['CCHA', 'ccha'], ['Atlantic Hockey America', 'atlantic-hockey']];
async function standings() {
  const s = seasonCode();
  const out = {};
  for (const [name, slug] of CONFS) {
    try {
      const t = tables(await text(`${CHI}/conferences/${slug}/standings${s}.php`))[0] || [];
      let lastRank = 0;
      out[name] = t.filter(r => r.length >= 19 && r[1].t && !/^GP$/.test(r[2].t)).map(r => {
        const c = r.map(x => x.t);
        if (c[0]) lastRank = +c[0] || lastRank;
        return { rank: lastRank, team: c[1], gp: +c[2], pts: num(c[3]), w: +c[4], l: +c[5], t: +c[6], otw: +c[7], otl: +c[8], sow: +c[9], gf: +c[10], ga: +c[11],
          ogp: +c[13], ow: +c[14], ol: +c[15], ot: +c[16], ogf: +c[17], oga: +c[18] };
      });
    } catch (e) { out[name] = { error: String(e.message || e) }; }
    await sleep(250);
  }
  return { source: 'College Hockey Inc.', season: '20' + (+s - 1) + '-' + s, conferences: out };
}

// ---- stats ------------------------------------------------------------
async function stats() {
  const s = seasonCode();
  const pick = (html, minCells) => (tables(html)[0] || []).filter(r => r.length >= minCells && r[1] && r[1].t && !/^Name$/i.test(r[1].t));
  const sk = pick(await text(`${CHI}/conferences/national/natplayer${s}.php`), 20);
  await sleep(250);
  const gk = pick(await text(`${CHI}/conferences/national/natgoalie${s}.php`), 14);
  await sleep(250);
  const tmTables = tables(await text(`${CHI}/conferences/national/natteam${s}.php`));
  const tm = (tmTables[0] || []).filter(r => r.length >= 20 && r[0].t && !/^Team$/i.test(r[0].t));
  // skater: name team pos yr gp g a pts ptsgm pim shots gwg ppg shg pm blk fw fl fopct
  const skaters = sk.map(r => { const c = r.map(x => x.t); return [c[1], c[2], c[3], c[4], +c[5], +c[6], +c[7], +c[8], num(c[9]), +c[10], +c[11], +c[12], +c[13], +c[14], num(c[15]), +c[16], +c[17], +c[18], num(c[19])]; });
  // goalie: name team yr gp w l t ga min gaa so sv svpct
  const goalies = gk.map(r => { const c = r.map(x => x.t); return [c[1], c[2], c[3], +c[4], +c[5], +c[6], +c[7], +c[8], c[9], num(c[10]), +c[11], +c[12], num(c[13])]; });
  // team: team gp g ga sh shpct sha svpct ppg ppo pppct ppga ppoa pkpct shg shga fow fol fopct blk
  const teams = tm.map(r => { const c = r.map(x => x.t); return [c[0]].concat(c.slice(1, 20).map(num)); });
  return { source: 'College Hockey Inc.', season: '20' + (+s - 1) + '-' + s,
    skaterCols: ['name', 'team', 'pos', 'yr', 'gp', 'g', 'a', 'pts', 'ptsgm', 'pim', 'shots', 'gwg', 'ppg', 'shg', 'pm', 'blk', 'fw', 'fl', 'fopct'],
    goalieCols: ['name', 'team', 'yr', 'gp', 'w', 'l', 't', 'ga', 'min', 'gaa', 'so', 'sv', 'svpct'],
    teamCols: ['team', 'gp', 'g', 'ga', 'sh', 'shpct', 'sha', 'svpct', 'ppg', 'ppo', 'pppct', 'ppga', 'ppoa', 'pkpct', 'shg', 'shga', 'fow', 'fol', 'fopct', 'blk'],
    skaters, goalies, teams };
}

// ---- meta (school slugs for logos) -----------------------------------
async function meta() {
  const j = await json(NCAA + '/schools-index');
  const list = Array.isArray(j) ? j : (j.data || j.schools || []);
  const schools = list.map(o => ({ slug: o.slug || o.seo || o.seoname || '', name: o.name || o.short || o.shortName || '', long: o.long || o.longName || o.long_name || o.nameFull || '' }))
    .filter(o => o.slug);
  return { source: 'NCAA', schools };
}

const TYPES = {
  rankings: { ttl: 1800, run: async () => {
    const [a, b, c] = await Promise.allSettled([npi(), uscho(), usaHockey()]);
    const v = (r) => r.status === 'fulfilled' ? r.value : { error: String(r.reason && r.reason.message || r.reason), rows: [] };
    return { npi: v(a), uscho: v(b), usah: v(c) };
  } },
  standings: { ttl: 600, run: standings },
  stats: { ttl: 900, run: stats },
  meta: { ttl: 86400, run: meta },
  schedule: { ttl: 900, run: schedule },
};

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type');
  if (type === 'roster') {
    try {
      const body = await roster(params.get('team') || '');
      body.fetchedAt = new Date().toISOString();
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=0, s-maxage=43200, stale-while-revalidate=86400', 'x-fetched-at': body.fetchedAt } });
    } catch (e) { return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 404, headers: { 'content-type': 'application/json' } }); }
  }
  const t = TYPES[type];
  if (!t) return new Response(JSON.stringify({ error: 'unknown type' }), { status: 404, headers: { 'content-type': 'application/json' } });
  try {
    const body = await t.run();
    body.fetchedAt = new Date().toISOString();
    return new Response(JSON.stringify(body), { headers: {
      'content-type': 'application/json',
      'cache-control': `public, max-age=0, s-maxage=${t.ttl}, stale-while-revalidate=${t.ttl * 2}`,
      'x-fetched-at': body.fetchedAt } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
}

// ---- official sites + school roster pages (jersey numbers, photos) ----
export const SITES = {
  'arizona state': 'thesundevils.com', 'colorado college': 'cctigers.com', 'denver': 'denverpioneers.com', 'miami': 'miamiredhawks.com',
  'minnesota duluth': 'umdbulldogs.com', 'north dakota': 'fightinghawks.com', 'omaha': 'omavs.com', 'st cloud state': 'scsuhuskies.com',
  'st thomas': 'tommiesports.com', 'western michigan': 'wmubroncos.com',
  'michigan': 'mgoblue.com', 'michigan state': 'msuspartans.com', 'minnesota': 'gophersports.com', 'notre dame': 'fightingirish.com',
  'ohio state': 'ohiostatebuckeyes.com', 'penn state': 'gopsusports.com', 'wisconsin': 'uwbadgers.com',
  'boston college': 'bceagles.com', 'boston university': 'goterriers.com', 'connecticut': 'uconnhuskies.com', 'maine': 'goblackbears.com',
  'massachusetts': 'umassathletics.com', 'massachusetts lowell': 'goriverhawks.com', 'merrimack': 'merrimackathletics.com',
  'new hampshire': 'unhwildcats.com', 'northeastern': 'nuhuskies.com', 'providence': 'friars.com', 'vermont': 'uvmathletics.com',
  'brown': 'brownbears.com', 'clarkson': 'clarksonathletics.com', 'colgate': 'colgateathletics.com', 'cornell': 'cornellbigred.com',
  'dartmouth': 'dartmouthsports.com', 'harvard': 'gocrimson.com', 'princeton': 'goprincetontigers.com', 'quinnipiac': 'gobobcats.com',
  'rensselaer': 'rpiathletics.com', 'st lawrence': 'saintsathletics.com', 'union': 'unionathletics.com', 'yale': 'yalebulldogs.com',
  'augustana': 'goaugie.com', 'bemidji state': 'bsubeavers.com', 'bowling green': 'bgsufalcons.com', 'ferris state': 'ferrisstatebulldogs.com',
  'lake superior state': 'lssuathletics.com', 'michigan tech': 'michigantechhuskies.com', 'minnesota state': 'msumavericks.com', 'northern michigan': 'nmuwildcats.com',
  'air force': 'goairforcefalcons.com', 'army': 'goarmywestpoint.com', 'bentley': 'bentleyfalcons.com', 'canisius': 'gogriffs.com',
  'holy cross': 'goholycross.com', 'niagara': 'purpleeagles.com', 'rochester institute of technology': 'ritathletics.com',
  'robert morris': 'rmucolonials.com', 'sacred heart': 'sacredheartpioneers.com',
  'alaska': 'alaskananooks.com', 'alaska anchorage': 'goseawolves.com', 'lindenwood': 'lindenwoodlions.com', 'long island': 'liuathletics.com', 'stonehill': 'stonehillskyhawks.com',
};
const ROSTER_PATHS = ['/sports/mens-ice-hockey/roster', '/sports/ice-hockey/roster', '/sports/mens-hockey/roster', '/sports/hockey/roster', '/sports/m-hockey/roster', '/sports/mice/roster'];
const MOBILE_UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const strip = s => decode(String(s || '').replace(/<[^>]+>/g, ' '));
const POS_RE = /^(F|D|G|C|LW|RW|W|LD|RD|Forward|Defense(?:man)?|Goalie|Goaltender|Center|Wing|Left Wing|Right Wing)$/i;
function absUrl(u, base) { if (!u) return ''; u = u.replace(/&amp;/g, '&'); if (/^https?:/i.test(u)) return u; if (u.startsWith('//')) return 'https:' + u; return base.replace(/\/$/, '') + (u.startsWith('/') ? '' : '/') + u; }
function pickImg(block, base) {
  const m = block.match(/<img[^>]+(?:data-src|src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i) || block.match(/<img[^>]+(?:data-src|src)="(https:\/\/images\.sidearmdev\.com[^"]+)"/i);
  return m ? absUrl(m[1], base) : '';
}
function parseClassic(html, base) {
  const parts = html.split(/<li[^>]+class="[^"]*sidearm-roster-player(?=[\s"])[^"]*"/i).slice(1);
  return parts.map(b => {
    const num = strip((b.match(/sidearm-roster-player-jersey-number[^>]*>([\s\S]*?)<\//) || [])[1]);
    const name = strip((b.match(/sidearm-roster-player-name[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
    const posRaw = strip((b.match(/sidearm-roster-player-position[^>]*>([\s\S]*?)<\/(?:div|span)>/) || [])[1]);
    const yr = strip((b.match(/sidearm-roster-player-academic-year[^>]*>([\s\S]*?)<\//) || [])[1]);
    const ht = strip((b.match(/sidearm-roster-player-height[^>]*>([\s\S]*?)<\//) || [])[1]);
    const town = strip((b.match(/sidearm-roster-player-hometown[^>]*>([\s\S]*?)<\//) || [])[1]);
    return { num: (num.match(/\d{1,2}/) || [''])[0], name, pos: (posRaw.match(/\b(LW|RW|LD|RD|F|D|G|C|W|Forward|Defense(?:man)?|Goalie|Goaltender)\b/i) || [''])[0], yr, ht, town, img: pickImg(b, base) };
  }).filter(p => p.name);
}
function parseCards(html, base) {
  const parts = html.split(/<(?:div|li|article)[^>]+class="[^"]*\bs-person-card(?=[\s"])[^"]*"/i).slice(1);
  return parts.map(b => {
    b = b.slice(0, 6000);
    const texts = (b.match(/>([^<>]{1,80})</g) || []).map(t => decode(t.slice(1, -1))).filter(Boolean);
    const si = b.indexOf('s-stamp__text');
    const stampTxt = si >= 0 ? strip(b.slice(si, si + 160).replace(/^[^>]*>/, '')) : '';
    const num = (stampTxt.match(/^\D{0,3}(\d{1,2})\b/) || b.match(/Jersey Number[^0-9]{0,40}(\d{1,2})/i) || [])[1] || '';
    const nameM = b.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || b.match(/<a[^>]+href="[^"]*\/roster\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i);
    const name = strip(nameM && nameM[1]);
    const pos = texts.find(t => POS_RE.test(t)) || '';
    const yr = texts.find(t => /^(Fr|So|Jr|Sr|Gr|R-?Fr|R-?So|R-?Jr|R-?Sr|Freshman|Sophomore|Junior|Senior|Graduate|5th)\.?/i.test(t)) || '';
    const ht = texts.find(t => /^\d['’]\s?\d{1,2}["”]?$/.test(t)) || '';
    return { num, name, pos, yr, ht, town: '', img: pickImg(b, base) };
  }).filter(p => p.name);
}
export async function roster(key) {
  const domain = SITES[key];
  if (!domain) throw new Error('unknown team');
  let html = '', url = '';
  for (const p of ROSTER_PATHS) {
    try {
      const r = await fetch('https://' + domain + p, { headers: MOBILE_UA, redirect: 'follow', signal: AbortSignal.timeout(7000) });
      if (!r.ok) continue;
      const h = await r.text();
      if (h.length > 5000 && /roster/i.test(h)) { html = h; url = r.url || ('https://' + domain + p); break; }
    } catch (e) { /* next path */ }
  }
  if (!html) return { site: 'https://' + domain, rosterUrl: '', players: [], error: 'roster page not found' };
  const base = new URL(url).origin;
  let players = parseClassic(html, base);
  if (players.length < 5) players = parseCards(html, base);
  const seen = {};
  players = players.filter(p => { const k = p.name.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
  return { site: 'https://' + domain, rosterUrl: url, players };
}

// ---- national schedule (College Hockey Inc. composite) ---------------
export async function schedule() {
  const s = seasonCode();
  const html = await text(`${CHI}/men/compnatfull${s}.php`);
  const rows = tables(html)[0] || [];
  const games = []; let date = '', exhib = false;
  rows.forEach(r => {
    const c = r.map(x => x.t);
    const joined = c.join(' ').trim();
    const dm = joined.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Z][a-z]+ \d{1,2}, \d{4})/);
    if (dm) { const d = new Date(dm[1] + ' 12:00 UTC'); date = isNaN(d) ? '' : d.toISOString().slice(0, 10); exhib = /exhibition/i.test(joined); return; }
    const at = c.findIndex(x => /^(at|vs\.?)$/i.test(x));
    if (at < 1 || !date) return;
    games.push({ date, away: c[at - 2] !== undefined && at >= 2 ? c[at - 2] : c[0], as: at >= 2 ? c[at - 1] : '', home: c[at + 1] || '', hs: c[at + 2] || '', note: c[at + 3] || '', neutral: /^vs/i.test(c[at]), exhibition: exhib });
  });
  return { source: 'College Hockey Inc.', season: '20' + (+s - 1) + '-' + s, games };
}
