/**
 * Astro API endpoint — proxies to the calendar Worker (or runs inline when
 * serving from Pages Functions). Returns JSON array of events.
 */
export const prerender = false;

import type { APIContext } from 'astro';

const CACHE_TTL = 600;

export async function GET({ locals }: APIContext) {
  const env = (locals as any).runtime?.env;

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': `public, max-age=${CACHE_TTL}`,
  };

  if (!env?.GOOGLE_CALENDAR_ID || !env?.GOOGLE_CALENDAR_API_KEY) {
    return new Response(JSON.stringify({ error: 'missing_env', vars: Object.keys(env || {}) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // Try KV cache
  if (env.CACHE) {
    const cached = await env.CACHE.get('calendar:events');
    if (cached) return new Response(cached, { headers });
  }

  const now = new Date().toISOString();
  const apiUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`
  );
  apiUrl.searchParams.set('key', env.GOOGLE_CALENDAR_API_KEY);
  apiUrl.searchParams.set('timeMin', now);
  apiUrl.searchParams.set('maxResults', '50');
  apiUrl.searchParams.set('singleEvents', 'true');
  apiUrl.searchParams.set('orderBy', 'startTime');

  try {
    const res = await fetch(apiUrl.toString(), {
      headers: { 'Referer': 'https://kinneykarate.pages.dev' },
    });
    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: 'google_api_error', status: res.status, body: errText }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const data: any = await res.json();
    const events = (data.items || []).map((item: any) => {
      const start = item.start?.dateTime || item.start?.date;
      const end = item.end?.dateTime || item.end?.date;
      const desc = item.description || '';
      const urlMatch = desc.match(/https?:\/\/[^\s<>"]+/);
      return {
        id: item.id,
        title: item.summary || '',
        start, end,
        location: item.location || null,
        url: urlMatch ? urlMatch[0] : null,
        allDay: Boolean(item.start?.date && !item.start?.dateTime),
      };
    });

    const json = JSON.stringify(events);
    if (env.CACHE) await env.CACHE.put('calendar:events', json, { expirationTtl: CACHE_TTL });
    return new Response(json, { headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'exception', message: err?.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
