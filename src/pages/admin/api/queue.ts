export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../lib/adminAuth';

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  const rows = (await env.DB.prepare(`
    SELECT oi.*, o.student_name, o.location, o.instructor_name, o.created_at AS order_date
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE (oi.fulfillment_type = 'made_to_order' OR oi.backordered = 1)
      AND o.status NOT IN ('picked_up', 'canceled')
    ORDER BY oi.produce_by ASC, o.created_at ASC
  `).all()).results;

  // Attach components
  const ids = (rows as any[]).map((r: any) => r.id);
  let components: any[] = [];
  if (ids.length) {
    components = (await env.DB.prepare(`
      SELECT * FROM order_item_components WHERE order_item_id IN (${ids.map(() => '?').join(',')})
    `).bind(...ids).all()).results;
  }

  const compMap: Record<number, any[]> = {};
  for (const c of components as any[]) {
    if (!compMap[c.order_item_id]) compMap[c.order_item_id] = [];
    compMap[c.order_item_id].push(c);
  }

  const enriched = (rows as any[]).map((r: any) => ({ ...r, components: compMap[r.id] || [] }));

  return new Response(JSON.stringify(enriched), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
