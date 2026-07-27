export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth } from '../../../lib/adminAuth';

export async function GET({ request, cookies, locals }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return new Response('Unauthorized', { status: 401 });
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });

  // Fetch active, non-special-order products with their variants and stock
  const products = await env.DB.prepare(`
    SELECT p.id, p.name, p.category, p.kind, p.fulfillment_type
    FROM products p
    WHERE p.active = 1 AND p.special_order = 0
    ORDER BY p.category, p.name
  `).all() as any;

  const result = [];
  for (const p of products.results) {
    const variants = await env.DB.prepare(`
      SELECT v.id, v.size, v.color, v.price_cents, COALESCE(i.on_hand, 0) as on_hand
      FROM variants v
      LEFT JOIN inventory i ON i.variant_id = v.id
      WHERE v.product_id = ? AND v.active = 1 AND v.sku != 'set'
      ORDER BY v.size, v.color
    `).bind(p.id).all() as any;

    // For simple single-variant products, flatten price to top level
    const vrows = variants.results;
    const price_cents = (vrows.length === 1 && !vrows[0].size && !vrows[0].color)
      ? vrows[0].price_cents : null;

    result.push({
      ...p,
      price_cents,
      variants: price_cents ? [] : vrows,
    });
  }

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}
