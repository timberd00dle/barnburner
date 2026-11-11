// Temporary diagnostic #5: runs the real roster + schedule parsers on live pages,
// tries alternate sites for the 5 misses, and samples play-by-play events. Delete after use.
import { roster, schedule, SITES } from './data.js';
export const maxDuration = 60;
const ALT = { 'notre dame': ['und.com'], 'harvard': ['gocrimson.com'], 'ferris state': ['ferrisstatebulldogs.com'], 'lake superior state': ['lssuathletics.com', 'lssulakers.com'], 'lindenwood': ['lindenwoodlions.com', 'lindenwood.edu'] };
const UA = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

function skeleton(html) {
  const i = html.search(/s-person-card|sidearm-roster-player/);
  if (i < 0) return 'no card marker';
  const b = html.slice(i, i + 5000);
  const cls = Array.from(b.matchAll(/<(\w+)[^>]*class="([^"]+)"[^>]*>([^<]{0,30})/g)).slice(0, 30).map(m => m[1] + '.' + m[2].split(' ')[0] + (m[3].trim() ? '=' + m[3].trim() : ''));
  return cls.join(' > ');
}
export async function GET() {
  const keys = Object.keys(SITES);
  const altJobs = [];
  for (const k of Object.keys(ALT)) for (const d of ALT[k]) for (const p of ['/sports/mens-ice-hockey/roster', '/sports/hockey/roster', '/sports/mens-hockey/roster', '/'])
    altJobs.push(fetch('https://' + d + p, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(5000) }).then(r => `${k} ${d}${p} -> ${r.status} ${r.url}`).catch(e => `${k} ${d}${p} -> ${e.name}`));
  const [res, alt, schedR, pbpR] = await Promise.all([
    Promise.all(keys.map(k => roster(k).catch(e => ({ error: e.message, players: [] })))),
    Promise.resolve().then(() => Promise.all(altJobs)),
    schedule().then(s => ({ s })).catch(e => ({ e: e.message })),
    fetch('https://ncaa-api.henrygd.me/game/6643179/play-by-play', { signal: AbortSignal.timeout(7000) }).then(r => r.json()).then(j => ({ j })).catch(e => ({ e: e.message })),
  ]);
  const lines = [];
  const needSkeleton = [];
  keys.forEach((k, i) => {
    const r = res[i]; const p = r.players || [];
    const withNum = p.filter(x => x.num).length, withImg = p.filter(x => x.img).length, withPos = p.filter(x => x.pos).length;
    lines.push(`${k} | players=${p.length} num=${withNum} img=${withImg} pos=${withPos} | ${r.rosterUrl || r.error || ''} | ${p.slice(0, 2).map(x => '#' + x.num + ' ' + x.name + ' ' + x.pos + ' ' + x.yr + (x.img ? ' [img]' : '')).join(' ; ')}`);
    if (r.rosterUrl && (p.length < 5 || withNum < p.length / 2)) needSkeleton.push(r.rosterUrl);
  });
  const skel = await Promise.all(needSkeleton.slice(0, 6).map(u => fetch(u, { headers: UA, signal: AbortSignal.timeout(5000) }).then(r => r.text()).then(h => u + ' :: ' + skeleton(h)).catch(e => u + ' :: ' + e.message)));
  let sched = '';
  try {
    if (schedR.e) throw new Error(schedR.e);
    const g = schedR.s.games;
    const reg = g.filter(x => !x.exhibition);
    const future = g.filter(x => !x.as && !x.hs).slice(0, 3);
    sched = `games=${g.length} regular=${reg.length}\nfirst: ${JSON.stringify(g.slice(0, 2))}\nmid: ${JSON.stringify(g.slice(400, 402))}\nfuture: ${JSON.stringify(future)}`;
  } catch (e) { sched = 'error ' + e.message; }
  let pbp = '';
  try {
    if (pbpR.e) throw new Error(pbpR.e);
    const j = pbpR.j;
    const plays = ((j.periods || [])[0] || {}).playbyplayStats || [];
    const pen = plays.filter(p => /penal|minor|major|min\b|hooking|tripping|slashing/i.test(JSON.stringify(p))).slice(0, 3);
    pbp = 'keys: ' + Object.keys(plays[0] || {}).join(', ') + '\nfirst3: ' + JSON.stringify(plays.slice(0, 3)) + '\npenalties: ' + JSON.stringify(pen);
  } catch (e) { pbp = 'error ' + e.message; }
  const ok = lines.filter(l => !/players=0 /.test(l)).length;
  const text = `ROSTERS PARSED: ${ok} of ${keys.length}\n${lines.join('\n')}\n\nCARD SKELETONS (low parse)\n${skel.join('\n')}\n\nALT SITES\n${alt.join('\n')}\n\nSCHEDULE\n${sched}\n\nPLAY-BY-PLAY\n${pbp}\n`;
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
