/**
 * Route Companion — Overpass caching proxy (Cloudflare Worker)
 *
 * Deploy: Cloudflare dashboard → Workers & Pages → Create Worker → paste this → Deploy
 * Usage:  https://<your-worker>.<your-subdomain>.workers.dev/?data=<overpass query>
 *
 * - Caches Overpass responses for 6 hours (route areas rarely change fast)
 * - Falls back across 4 public Overpass mirrors, in-memory per-isolate cache
 * - Free tier: 100k requests/day, no credit card needed
 */

// Mirrors NOT behind Cloudflare first — Workers fetching Cloudflare-proxied
// sites hit 521/526 or hang. osm.ch last (Switzerland-only data).
const UPSTREAMS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_AGE_S = 6 * 60 * 60;
const REQUEST_TIMEOUT_MS = 10000;

const cache = new Map();

function cacheKey(query) {
  // normalize whitespace so trivial differences don't split the cache
  return query.replace(/\s+/g, " ").trim();
}

async function fetchFromUpstreams(query) {
  const errors = [];
  for (const upstream of UPSTREAMS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${upstream}?data=${encodeURIComponent(query)}`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429) {
        errors.push(`${upstream}: 429 rate-limited`);
        continue;
      }
      if (!res.ok) {
        errors.push(`${upstream}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        errors.push(`${upstream}: non-JSON response`);
        continue;
      }
      if (parsed && Array.isArray(parsed.elements)) {
        return { status: 200, body: JSON.stringify(parsed), errors };
      }
      errors.push(`${upstream}: no elements array`);
    } catch (e) {
      errors.push(`${upstream}: ${e.name || "fetch error"}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    status: 502,
    body: JSON.stringify({ error: "all upstreams failed", detail: errors }),
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const query = url.searchParams.get("data");
    if (!query) {
      return new Response(JSON.stringify({ error: "missing ?data= parameter" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
    }

    const key = cacheKey(query);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.t < CACHE_TTL_MS) {
      return new Response(hit.body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "access-control-allow-origin": "*",
          "cache-control": `public, max-age=${MAX_AGE_S}`,
          "x-cache": "HIT",
        },
      });
    }

    // opportunistic cache eviction (Map can grow on long-lived isolates)
    if (cache.size > 500) {
      for (const [k, v] of cache) {
        if (now - v.t > CACHE_TTL_MS) cache.delete(k);
      }
    }

    const result = await fetchFromUpstreams(query);
    const headers = {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "x-cache": "MISS",
    };
    if (result.status === 200) {
      cache.set(key, { body: result.body, t: now });
      headers["cache-control"] = `public, max-age=${MAX_AGE_S}`;
      return new Response(result.body, { status: 200, headers });
    }
    return new Response(result.body, { status: 502, headers });
  },
};
