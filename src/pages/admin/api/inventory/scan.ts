export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../../lib/adminAuth';

export async function POST({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  let body: any;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { barcode, mode, staff } = body;
  if (!barcode) return err('barcode required', 400);
  if (!['check_in', 'take_out'].includes(mode)) return err('invalid mode', 400);

  // Look up variant by barcode
  const variant = await env.DB.prepare(`
    SELECT v.*, p.name AS product_name, p.fulfillment_type
    FROM variants v JOIN products p ON p.id = v.product_id
    WHERE v.barcode = ? AND v.active = 1
  `).bind(barcode).first() as any;

  if (!variant) return json({ unknown: true });

  const delta = mode === 'check_in' ? 1 : -1;
  const reason = mode === 'check_in' ? 'received' : 'in_person_sale';

  // Upsert inventory
  await env.DB.prepare(`
    INSERT INTO inventory (variant_id, on_hand) VALUES (?, ?)
    ON CONFLICT(variant_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand
  `).bind(variant.id, delta).run();

  // Log movement
  await env.DB.prepare(`
    INSERT INTO inventory_movements (variant_id, delta, reason, source, staff)
    VALUES (?, ?, ?, 'scan', ?)
  `).bind(variant.id, delta, reason, staff || 'admin').run();

  const inv = await env.DB.prepare('SELECT on_hand FROM inventory WHERE variant_id = ?').bind(variant.id).first() as any;

  return json({ variant, on_hand: inv?.on_hand ?? delta });
}

function json(data: any) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
