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
};

export async function GET(request) {
  const type = new URL(request.url).searchParams.get('type');
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
