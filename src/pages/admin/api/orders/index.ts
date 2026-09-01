export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../../lib/adminAuth';

export async function GET({ url, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

  const orders = (await env.DB.prepare(`
    SELECT * FROM orders ORDER BY created_at DESC LIMIT ?
  `).bind(limit).all()).results as any[];

  if (orders.length === 0) return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });

  const ids = orders.map(o => `'${o.id.replace(/'/g, "''")}'`).join(',');
  const items = (await env.DB.prepare(`
    SELECT * FROM order_items WHERE order_id IN (${ids}) ORDER BY id ASC
  `).all()).results as any[];

  const itemMap: Record<string, any[]> = {};
  for (const item of items) {
    if (!itemMap[item.order_id]) itemMap[item.order_id] = [];
    itemMap[item.order_id].push(item);
  }

  const result = orders.map(o => ({ ...o, items: itemMap[o.id] || [] }));

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
