export const prerender = false;
import type { APIContext } from 'astro';

export async function GET({ locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  const rows = (await env.DB.prepare('SELECT name FROM instructors WHERE active=1 ORDER BY name ASC').all()).results;
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
}
