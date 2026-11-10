// Barnburner data relay (Vercel serverless function).
// /api/<path>  ->  UPSTREAM/<path>   (vercel.json rewrites /api/* here as ?path=...)
// Vercel's CDN caches each answer for a few seconds (s-maxage), so every phone
// shares one copy and the data source only sees one visitor.

const UPSTREAM = process.env.UPSTREAM || 'https://ncaa-api.henrygd.me';
const ALLOWED = /^\/(scoreboard|game|rankings|standings|stats|schedule|news|logo|schools-index)(\/|$)/;

function ttlFor(path) {
  if (path.startsWith('/scoreboard')) return 20;  // live scores
  if (path.startsWith('/game')) return 15;        // box scores during games
  if (path.startsWith('/logo')) return 86400;     // logos rarely change
  return 300;                                     // standings, rankings, etc.
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function GET(request) {
  const url = new URL(request.url);
  const path = '/' + String(url.searchParams.get('path') || '').replace(/^\/+/, '');
  url.searchParams.delete('path');
  if (!ALLOWED.test(path) || path.includes('..')) return json({ error: 'not found' }, 404);

  const qs = url.searchParams.toString();
  const target = UPSTREAM + path + (qs ? '?' + qs : '');
  const headers = { accept: path.startsWith('/logo') ? 'image/svg+xml,*/*' : 'application/json' };
  if (process.env.NCAA_HEADER_KEY) headers['x-ncaa-key'] = process.env.NCAA_HEADER_KEY; // only if you self-host with a key

  let up;
  try {
    up = await fetch(target, { headers });
  } catch (e) {
    return json({ error: 'data source unreachable' }, 502);
  }

  const ttl = ttlFor(path);
  const out = new Headers();
  out.set('content-type', up.headers.get('content-type') || 'application/json');
  out.set('x-fetched-at', new Date().toISOString());
  out.set(
    'cache-control',
    up.ok ? `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl}` : 'no-store'
  );
  return new Response(up.body, { status: up.status, headers: out });
}
