export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../../lib/adminAuth';

export async function GET({ url, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

  const rows = (await env.DB.prepare(`
    SELECT m.*, v.size, v.color, v.barcode, p.name AS product_name
    FROM inventory_movements m
    JOIN variants v ON v.id = m.variant_id
    JOIN products p ON p.id = v.product_id
    ORDER BY m.created_at DESC
    LIMIT ?
  `).bind(limit).all()).results;

  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
