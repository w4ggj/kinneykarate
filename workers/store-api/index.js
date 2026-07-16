/**
 * Store API Worker — product reads, cart validation, Stripe Checkout session creation.
 * All prices come from D1 — client-submitted prices are never trusted.
 *
 * Routes:
 *   GET  /api/products          → product list
 *   GET  /api/products/:slug    → single product + variants + components
 *   POST /api/checkout          → create Stripe Checkout session
 *   GET  /api/settings          → public settings (backorders, announcement)
 */

import { Router } from './router.js';

const router = new Router();

// ── Products ─────────────────────────────────────────────────────────────────

router.get('/api/products', async (req, env) => {
  const rows = await env.DB.prepare(`
    SELECT p.id, p.slug, p.name, p.category, p.kind, p.fulfillment_type,
           p.special_order, p.description,
           MIN(v.price_cents) AS min_price, MAX(v.price_cents) AS max_price
    FROM products p
    LEFT JOIN variants v ON v.product_id = p.id AND v.active = 1
    WHERE p.active = 1
    GROUP BY p.id ORDER BY p.sort_order, p.id
  `).all();
  return json(rows.results);
});

router.get('/api/products/:slug', async (req, env, params) => {
  const product = await env.DB.prepare(
    'SELECT * FROM products WHERE slug = ? AND active = 1'
  ).bind(params.slug).first();
  if (!product) return json({ error: 'Not found' }, 404);

  const variants = (await env.DB.prepare(
    'SELECT * FROM variants WHERE product_id = ? AND active = 1'
  ).bind(product.id).all()).results;

  const components = product.kind === 'bundle'
    ? (await env.DB.prepare(
        'SELECT * FROM bundle_components WHERE bundle_product_id = ? ORDER BY sort_order'
      ).bind(product.id).all()).results
    : [];

  // Inventory for stocked variants
  let inventory = {};
  if (product.fulfillment_type === 'stocked' && variants.length) {
    const ids = variants.map(v => v.id).join(',');
    const inv = await env.DB.prepare(
      `SELECT variant_id, on_hand FROM inventory WHERE variant_id IN (${ids})`
    ).all();
    for (const row of inv.results) inventory[row.variant_id] = row.on_hand;
  }

  const settings = await env.DB.prepare(
    'SELECT allow_backorders FROM settings WHERE id = 1'
  ).first();

  return json({ product, variants, components, inventory, allow_backorders: settings?.allow_backorders ?? 1 });
});

// ── Settings (public) ─────────────────────────────────────────────────────────

router.get('/api/settings', async (req, env) => {
  const s = await env.DB.prepare(
    'SELECT allow_backorders, announcement_text, announcement_on FROM settings WHERE id = 1'
  ).first();
  return json(s || {});
});

// ── Checkout ─────────────────────────────────────────────────────────────────

router.post('/api/checkout', async (req, env) => {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { items, student_name, location, instructor_name, contact_email } = body;

  if (!student_name || !location || !instructor_name || !contact_email) {
    return json({ error: 'Missing required checkout fields' }, 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: 'Cart is empty' }, 400);
  }

  const settings = await env.DB.prepare(
    'SELECT allow_backorders FROM settings WHERE id = 1'
  ).first();
  const backordersOn = settings?.allow_backorders !== 0;

  // Build line items from D1 — never trust client prices
  const lineItems = [];
  const orderItems = [];
  let subtotal = 0;

  for (const item of items) {
    if (item.product_slug === 'sparring-pieces') {
      return json({ error: 'Special order items cannot be purchased online' }, 400);
    }

    const product = await env.DB.prepare(
      'SELECT * FROM products WHERE id = ? AND active = 1'
    ).bind(item.product_id).first();
    if (!product) return json({ error: `Product ${item.product_id} not found` }, 400);
    if (product.special_order) return json({ error: 'Special order items cannot be purchased online' }, 400);

    let priceCents;
    let variantId = null;

    if (product.kind === 'bundle') {
      // Bundle: fixed set price
      const bv = await env.DB.prepare(
        "SELECT price_cents FROM variants WHERE product_id = ? AND sku = 'set' LIMIT 1"
      ).bind(product.id).first();
      if (!bv) return json({ error: 'Bundle price not configured' }, 500);
      priceCents = bv.price_cents;
    } else {
      // Simple: look up by variant_id or size+color
      let variant;
      if (item.variant_id) {
        variant = await env.DB.prepare(
          'SELECT * FROM variants WHERE id = ? AND product_id = ? AND active = 1'
        ).bind(item.variant_id, product.id).first();
      } else if (item.size || item.color) {
        variant = await env.DB.prepare(
          'SELECT * FROM variants WHERE product_id = ? AND (size = ? OR size IS NULL) AND (color = ? OR color IS NULL) AND active = 1 LIMIT 1'
        ).bind(product.id, item.size || null, item.color || null).first();
      } else {
        variant = await env.DB.prepare(
          'SELECT * FROM variants WHERE product_id = ? AND active = 1 LIMIT 1'
        ).bind(product.id).first();
      }
      if (!variant) return json({ error: `Variant not found for ${product.name}` }, 400);
      priceCents = variant.price_cents;
      variantId = variant.id;

      // Stock check for stocked items
      if (product.fulfillment_type === 'stocked') {
        const inv = await env.DB.prepare(
          'SELECT on_hand FROM inventory WHERE variant_id = ?'
        ).bind(variant.id).first();
        const onHand = inv?.on_hand ?? 0;
        if (onHand <= 0 && !backordersOn) {
          return json({ error: `${product.name} (${variant.size || ''}) is out of stock` }, 409);
        }
      }
    }

    if (!priceCents) return json({ error: 'Price not set' }, 400);

    const qty = Math.max(1, parseInt(item.qty) || 1);

    // Duffle bag add-on
    if (item.addon_duffle) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Mesh Duffle Bag (add-on)' },
          unit_amount: 4000,
        },
        quantity: 1,
      });
      subtotal += 4000;
    }

    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: product.name + (item.size ? ` — Size ${item.size}` : '') + (item.color ? ` / ${item.color}` : ''),
          metadata: { product_id: String(product.id), variant_id: String(variantId || '') },
        },
        unit_amount: priceCents,
      },
      quantity: qty,
    });
    subtotal += priceCents * qty;

    orderItems.push({
      product_id: product.id,
      variant_id: variantId,
      name_snapshot: product.name,
      size: item.size || null,
      color: item.color || null,
      unit_price_cents: priceCents,
      qty,
      fulfillment_type: product.fulfillment_type,
      components: item.components || null,
    });
  }

  // Card surcharge (3.7%) — disclosed as a separate line item
  const SURCHARGE_RATE = 0.037;
  const surchargeCents = Math.round(subtotal * SURCHARGE_RATE);
  if (surchargeCents > 0) {
    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: { name: 'Card processing fee (3.7%)' },
        unit_amount: surchargeCents,
      },
      quantity: 1,
    });
  }

  const origin = new URL(req.url).origin;
  const orderId = crypto.randomUUID();

  // Create Stripe Checkout session
  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      mode: 'payment',
      success_url: `${origin}/store/success?order=${orderId}`,
      cancel_url: `${origin}/store`,
      customer_email: contact_email,
      'metadata[order_id]': orderId,
      'metadata[student_name]': student_name,
      'metadata[location]': location,
      'metadata[instructor_name]': instructor_name,
      'automatic_tax[enabled]': 'true',
      ...flattenLineItems(lineItems),
    }).toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.json();
    console.error('Stripe error:', err);
    return json({ error: 'Payment setup failed. Please try again.' }, 502);
  }

  const session = await stripeRes.json();

  // Persist pending order to D1 (webhook will confirm)
  await env.DB.prepare(`
    INSERT INTO orders (id, stripe_session_id, student_name, location, instructor_name,
                        contact_email, subtotal_cents, surcharge_cents, total_cents, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).bind(
    orderId, session.id, student_name, location, instructor_name,
    contact_email, subtotal, surchargeCents, subtotal + surchargeCents
  ).run();

  return json({ url: session.url });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/** Convert line items array to Stripe form-encoded flat params */
function flattenLineItems(items) {
  const params = {};
  items.forEach((item, i) => {
    params[`line_items[${i}][price_data][currency]`] = item.price_data.currency;
    params[`line_items[${i}][price_data][product_data][name]`] = item.price_data.product_data.name;
    params[`line_items[${i}][price_data][unit_amount]`] = String(item.price_data.unit_amount);
    params[`line_items[${i}][quantity]`] = String(item.quantity);
    if (item.price_data.product_data.metadata) {
      for (const [k, v] of Object.entries(item.price_data.product_data.metadata)) {
        params[`line_items[${i}][price_data][product_data][metadata][${k}]`] = v;
      }
    }
  });
  return params;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
      });
    }
    return router.handle(request, env, ctx);
  },
};
