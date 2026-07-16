export const prerender = false;
import type { APIContext } from 'astro';

export async function GET({ locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  const rows = (await env.DB.prepare(`
    SELECT v.id, v.barcode, v.size, v.color, v.sku,
           p.name AS product_name, p.slug, p.fulfillment_type,
           COALESCE(i.on_hand, 0) AS on_hand,
           COALESCE(i.low_stock_threshold, 2) AS low_stock_threshold
    FROM variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory i ON i.variant_id = v.id
    WHERE v.active = 1 AND p.active = 1 AND p.fulfillment_type = 'stocked'
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
