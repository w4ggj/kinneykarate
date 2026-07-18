export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../../lib/adminAuth';

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
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
    ORDER BY p.sort_order, p.name,
      CASE v.color WHEN 'White' THEN 0 WHEN 'Red' THEN 1 WHEN 'Blue' THEN 2 WHEN 'Black' THEN 3 ELSE 99 END,
      CASE v.size WHEN '0000' THEN 0 WHEN '000' THEN 1 WHEN '00' THEN 2 WHEN '0' THEN 3 WHEN '1' THEN 4 WHEN '2' THEN 5 WHEN '3' THEN 6 WHEN '4' THEN 7 WHEN '5' THEN 8 WHEN '6' THEN 9 WHEN '7' THEN 10 WHEN '8' THEN 11 ELSE 99 END
  `).all()).results;

  return json(rows);
}

function json(data: any) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
