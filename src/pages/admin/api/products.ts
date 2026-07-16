export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../lib/adminAuth';

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  const rows = (await env.DB.prepare(`
    SELECT * FROM products ORDER BY sort_order, name
  `).all()).results;

  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
