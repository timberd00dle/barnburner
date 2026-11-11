// Temporary diagnostic #4: official sites + roster pages for all 62 teams,
// the national schedule page, and box score player order (for line combos). Delete after use.
export const maxDuration = 60;

const SITES = {
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
const PATHS = ['/sports/mens-ice-hockey/roster', '/sports/ice-hockey/roster', '/sports/mens-hockey/roster', '/sports/hockey/roster', '/sports/m-hockey/roster', '/sports/mice/roster', '/hockey/roster/'];
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

async function tryPath(domain, p) {
    try {
      const r = await fetch('https://' + domain + p, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      const h = await r.text();
      if (!/roster/i.test(h) || h.length < 5000) return null;
      const count = re => (h.match(re) || []).length;
      const markers = {
        sidearmPlayer: count(/sidearm-roster-player-name/g), personCard: count(/s-person-card/g), nuxt: count(/__NUXT__|window\.__NUXT/g),
        ldjson: count(/application\/ld\+json/g), jersey: count(/jersey/gi), headshotImgs: count(/<img[^>]+(roster|headshot|player)[^>]*>/gi),
      };
      const num = (h.match(/sidearm-roster-player-jersey-number[^>]*>\s*([0-9]{1,2})/) || h.match(/"jerseyNumber"\s*:\s*"?([0-9]{1,2})/) || [])[1] || '';
      const name = ((h.match(/sidearm-roster-player-name[\s\S]{0,300}?<a[^>]*>([^<]{3,40})</) || h.match(/"(?:firstName|first_name)"\s*:\s*"([^"]+)"/) || [])[1] || '').trim();
      const img = (h.match(/<img[^>]+(?:data-src|src)="([^"]*(?:images|roster|headshot)[^"]*\.(?:jpe?g|png|webp)[^"]*)"/i) || [])[1] || '';
      return { ok: true, url: r.url, path: p, bytes: h.length, markers, sample: { num, name, img: img.slice(0, 140) } };
    } catch (e) { return null; }
}
async function tryRoster(domain) {
  const all = await Promise.all(PATHS.map(p => tryPath(domain, p)));
  return all.find(Boolean) || { ok: false };
}

export async function GET() {
  const keys = Object.keys(SITES);
  const results = {};
  const res = await Promise.all(keys.map(k => tryRoster(SITES[k])));
  keys.forEach((k, j) => { results[k] = res[j]; });
  const lines = keys.map(k => {
    const r = results[k];
    if (!r.ok) return `${k} | ${SITES[k]} | FAIL`;
    const m = r.markers;
    return `${k} | OK | ${r.url} | sidearmPlayer=${m.sidearmPlayer} personCard=${m.personCard} nuxt=${m.nuxt} ldjson=${m.ldjson} jersey=${m.jersey} imgs=${m.headshotImgs} | #${r.sample.num} ${r.sample.name} | img=${r.sample.img}`;
  });

  // box score player order (does it follow line order?)
  let order = 'n/a';
  try {
    const bx = await fetch('https://ncaa-api.henrygd.me/game/6643179/boxscore', { signal: AbortSignal.timeout(6000) }).then(r => r.json());
    order = (bx.teamBoxscore || []).map(t => 'TEAM ' + t.teamId + ': ' + (t.playerStats || []).map(p => `${p.number}-${p.position}${p.starter ? '*' : ''}`).join(', ')).join('\n');
  } catch (e) { order = 'error ' + e.message; }

  // national schedule page layout
  let sched = 'n/a';
  try {
    const h = await fetch('https://collegehockeyinc.com/men/compnatfull27.php', { headers: UA, signal: AbortSignal.timeout(6000) }).then(r => r.text());
    const rows = (h.match(/<tr[\s\S]*?<\/tr>/gi) || []).slice(0, 14).map(r => (r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(c => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()).join(' | '));
    sched = 'tables=' + (h.match(/<table/gi) || []).length + ' rows=' + (h.match(/<tr/gi) || []).length + '\n' + rows.join('\n');
  } catch (e) { sched = 'error ' + e.message; }

  const ok = lines.filter(l => / \| OK \| /.test(l)).length;
  const text = `ROSTERS: ${ok} of ${keys.length} found\n${lines.join('\n')}\n\nBOX SCORE ORDER (number-position, * = starter)\n${order}\n\nSCHEDULE PAGE\n${sched}\n`;
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
