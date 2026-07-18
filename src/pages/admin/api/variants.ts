export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../lib/adminAuth';

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  const rows = (await env.DB.prepare(`
    SELECT v.id, v.size, v.color, v.barcode,
           p.name AS product_name, p.slug
    FROM variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.active = 1 AND p.active = 1
    ORDER BY p.sort_order, p.name, v.size, v.color
  `).all()).results;

  return json(rows);
}

function json(data: any) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
