/**
 * Calendar Worker — proxies Google Calendar API, caches in KV (10-min TTL).
 * Returns: JSON array of { id, title, start, end, location, url, allDay }
 *
 * Event CTAs: if the event description contains a URL, it's extracted as `url`
 * so the front-end can render it as a button.
 */

const CACHE_KEY = 'calendar:events';
const CACHE_TTL = 600; // 10 minutes

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS for Astro front-end
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // Try KV cache first
    if (env.CACHE) {
      const cached = await env.CACHE.get(CACHE_KEY);
      if (cached) return new Response(cached, { headers });
    }

    if (!env.GOOGLE_CALENDAR_ID || !env.GOOGLE_CALENDAR_API_KEY) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    // Fetch from Google Calendar API
    const now = new Date().toISOString();
    const maxResults = 50;
    const apiUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/' +
      encodeURIComponent(env.GOOGLE_CALENDAR_ID) + '/events');
    apiUrl.searchParams.set('key', env.GOOGLE_CALENDAR_API_KEY);
    apiUrl.searchParams.set('timeMin', now);
    apiUrl.searchParams.set('maxResults', String(maxResults));
    apiUrl.searchParams.set('singleEvents', 'true');
    apiUrl.searchParams.set('orderBy', 'startTime');

    const res = await fetch(apiUrl.toString());
    if (!res.ok) {
      const err = await res.text();
      console.error('Calendar API error:', res.status, err);
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    const data = await res.json();
    const events = (data.items || []).map(item => {
      const start = item.start?.dateTime || item.start?.date;
      const end = item.end?.dateTime || item.end?.date;
      const allDay = Boolean(item.start?.date && !item.start?.dateTime);
      const desc = item.description || '';
      // Extract first URL from description for CTA
      const urlMatch = desc.match(/https?:\/\/[^\s<>"]+/);
      const url = urlMatch ? urlMatch[0] : null;

      return { id: item.id, title: item.summary || '', start, end, location: item.location || null, url, allDay };
    });

    const json = JSON.stringify(events);

    // Store in KV
    if (env.CACHE) {
      await env.CACHE.put(CACHE_KEY, json, { expirationTtl: CACHE_TTL });
    }

    return new Response(json, { headers });
  },
};
