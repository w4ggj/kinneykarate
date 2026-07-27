export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth } from '../../../lib/adminAuth';

const SURCHARGE_RATE = 0.037;

export async function POST({ request, cookies, locals }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return err('Unauthorized', 401);
  const env = (locals as any).runtime?.env;
  if (!env?.STRIPE_SECRET_KEY) return err('Stripe not configured', 503);

  let body: any;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { item_id, variant_id, price_cents, name } = body;
  if (!name || !price_cents || price_cents <= 0) return err('Invalid item', 400);

  // For store products, validate variant exists and has stock (or backorders on)
  if (variant_id) {
    const variant = await env.DB?.prepare(
      'SELECT v.id, v.price_cents, p.fulfillment_type FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND v.active = 1'
    ).bind(variant_id).first() as any;
    if (!variant) return err('Variant not found', 404);

    if (variant.fulfillment_type === 'stocked') {
      const settings = await env.DB.prepare('SELECT allow_backorders FROM settings WHERE id = 1').first() as any;
      const backordersOn = settings?.allow_backorders !== 0;
      const inv = await env.DB.prepare('SELECT on_hand FROM inventory WHERE variant_id = ?').bind(variant_id).first() as any;
      if ((inv?.on_hand ?? 0) <= 0 && !backordersOn) return err('Item is out of stock', 409);
    }
  }

  const priceCents = Math.round(price_cents);
  const surchargeCents = Math.round(priceCents * SURCHARGE_RATE);
  const origin = new URL(request.url).origin;

  const params = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/store/success`,
    cancel_url: `${origin}/admin`,
    'automatic_tax[enabled]': 'true',
  });

  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][product_data][name]', name);
  params.set('line_items[0][price_data][unit_amount]', String(priceCents));
  params.set('line_items[0][quantity]', '1');

  if (surchargeCents > 0) {
    params.set('line_items[1][price_data][currency]', 'usd');
    params.set('line_items[1][price_data][product_data][name]', 'Card processing fee (3.7%)');
    params.set('line_items[1][price_data][unit_amount]', String(surchargeCents));
    params.set('line_items[1][quantity]', '1');
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const e = await stripeRes.json() as any;
    return err(e.error?.message || 'Payment setup failed', 502);
  }

  const session = await stripeRes.json() as any;
  return new Response(JSON.stringify({ url: session.url }), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
