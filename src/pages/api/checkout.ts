export const prerender = false;
import type { APIContext } from 'astro';

const SURCHARGE_RATE = 0.037;

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('Store not available', 503);

  let body: any;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { items, student_name, location, instructor_name, contact_email } = body;
  if (!student_name || !location || !instructor_name || !contact_email) return err('Missing required fields', 400);
  if (!Array.isArray(items) || !items.length) return err('Cart is empty', 400);

  const settings = await env.DB.prepare('SELECT allow_backorders FROM settings WHERE id = 1').first() as any;
  const backordersOn = settings?.allow_backorders !== 0;

  const lineItems: any[] = [];
  const orderItemsData: any[] = [];
  let subtotal = 0;

  for (const item of items) {
    const product = await env.DB.prepare('SELECT * FROM products WHERE id = ? AND active = 1').bind(item.product_id).first() as any;
    if (!product) return err(`Product not found: ${item.product_id}`, 400);
    if (product.special_order) return err('Special order items cannot be purchased online', 400);

    let priceCents: number;
    let variantId: number | null = null;

    if (product.kind === 'bundle') {
      const bv = await env.DB.prepare("SELECT price_cents FROM variants WHERE product_id = ? AND sku = 'set' LIMIT 1").bind(product.id).first() as any;
      if (!bv) return err('Bundle not configured', 500);
      priceCents = bv.price_cents;
    } else {
      const variant = await env.DB.prepare(
        "SELECT * FROM variants WHERE product_id = ? AND active = 1 AND (size IS NULL OR size = '' OR size = ?) AND (color IS NULL OR color = '' OR color = ?) LIMIT 1"
      ).bind(product.id, item.size || '', item.color || '').first() as any;
      if (!variant) return err(`Variant not found for ${product.name}`, 400);
      priceCents = variant.price_cents;
      variantId = variant.id;

      if (product.fulfillment_type === 'stocked') {
        const inv = await env.DB.prepare('SELECT on_hand FROM inventory WHERE variant_id = ?').bind(variant.id).first() as any;
        if ((inv?.on_hand ?? 0) <= 0 && !backordersOn) return err(`${product.name} is out of stock`, 409);
      }
    }

    const qty = Math.max(1, parseInt(item.qty) || 1);
    if (item.addon_duffle) {
      lineItems.push(stripeLineItem('Mesh Duffle Bag (add-on)', 4000, 1));
      subtotal += 4000;
    }
    lineItems.push(stripeLineItem(
      product.name + (item.size ? ` — Size ${item.size}` : '') + (item.color ? ` / ${item.color}` : ''),
      priceCents, qty
    ));
    subtotal += priceCents * qty;
    orderItemsData.push({ product, variantId, item, priceCents, qty });
  }

  const surchargeCents = Math.round(subtotal * SURCHARGE_RATE);
  if (surchargeCents > 0) lineItems.push(stripeLineItem('Card processing fee (3.7%)', surchargeCents, 1));

  const orderId = crypto.randomUUID();
  const origin = new URL(request.url).origin;

  const params = new URLSearchParams({
    mode: 'payment',
    success_url: `${origin}/store/success?order=${orderId}`,
    cancel_url: `${origin}/store`,
    customer_email: contact_email,
    'metadata[order_id]': orderId,
    'metadata[student_name]': student_name,
    'metadata[location]': location,
    'metadata[instructor_name]': instructor_name,
    'automatic_tax[enabled]': 'true',
  });
  lineItems.forEach((li, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'usd');
    params.set(`line_items[${i}][price_data][product_data][name]`, li.name);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(li.unit_amount));
    params.set(`line_items[${i}][quantity]`, String(li.quantity));
  });

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

  // Write pending order + items to D1
  await env.DB.prepare(`INSERT INTO orders (id, stripe_session_id, student_name, location, instructor_name, contact_email, subtotal_cents, surcharge_cents, total_cents, status) VALUES (?,?,?,?,?,?,?,?,?,'paid')`
  ).bind(orderId, session.id, student_name, location, instructor_name, contact_email, subtotal, surchargeCents, subtotal + surchargeCents).run();

  for (const d of orderItemsData) {
    const r = await env.DB.prepare(`INSERT INTO order_items (order_id, product_id, variant_id, name_snapshot, size, color, unit_price_cents, qty, fulfillment_type) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(orderId, d.product.id, d.variantId, d.product.name, d.item.size||null, d.item.color||null, d.priceCents, d.qty, d.product.fulfillment_type).run();
    // Bundle components
    if (d.item.components && r.meta.last_row_id) {
      for (const [comp, size] of Object.entries(d.item.components)) {
        await env.DB.prepare('INSERT INTO order_item_components (order_item_id, component_name, chosen_size) VALUES (?,?,?)')
          .bind(r.meta.last_row_id, comp, size).run();
      }
    }
  }

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}

function stripeLineItem(name: string, unit_amount: number, quantity: number) {
  return { name, unit_amount, quantity };
}
