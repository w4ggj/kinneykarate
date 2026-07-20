export const prerender = false;
import type { APIContext } from 'astro';

export async function GET({ locals }: APIContext) {
  try {
    const env = (locals as any).runtime?.env;
    if (!env?.DB) return json({ on: false, text: '' });
    const row = await env.DB.prepare(
      'SELECT announcement_on, announcement_text FROM settings WHERE id = 1'
    ).first();
    return json({
      on: row ? !!row.announcement_on : false,
      text: row?.announcement_text ?? '',
    });
  } catch {
    return json({ on: false, text: '' });
  }
}

function json(data: object) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
