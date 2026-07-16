/**
 * Admin API Worker — behind Cloudflare Access.
 * All write routes require a valid CF Access JWT (verified by the Access middleware).
 *
 * Routes:
 *   GET    /admin/api/products
 *   POST   /admin/api/products
 *   PUT    /admin/api/products/:id
 *   DELETE /admin/api/products/:id
 *   GET    /admin/api/variants/:product_id
 *   POST   /admin/api/variants
 *   PUT    /admin/api/variants/:id
 *   DELETE /admin/api/variants/:id
 *   GET    /admin/api/inventory
 *   POST   /admin/api/inventory/scan        — barcode check-in / take-out
 *   POST   /admin/api/inventory/map         — map barcode → variant
 *   GET    /admin/api/inventory/movements
 *   GET    /admin/api/orders
 *   GET    /admin/api/orders/:id
 *   POST   /admin/api/orders/:id/status
 *   GET    /admin/api/queue                 — made-to-order queue
 *   GET    /admin/api/settings
 *   PUT    /admin/api/settings
 *   POST   /admin/api/contact               — contact form handler (public, Turnstile-gated)
 */

import { Router } from '../store-api/router.js';

const router = new Router();

// ── Products ──────────────────────────────────────────────────────────────────

router.get('/admin/api/products', async (req, env) => {
  const rows = await env.DB.prepare(
    'SELECT * FROM products ORDER BY sort_order, id'
  ).all();
  return json(rows.results);
});

router.post('/admin/api/products', async (req, env) => {
  const b = await req.json();
  const r = await env.DB.prepare(`
    INSERT INTO products (slug, name, description, category, kind, fulfillment_type, special_order, active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(b.slug, b.name, b.description||'', b.category||'', b.kind||'simple',
      b.fulfillment_type||'made_to_order', b.special_order||0, b.active??1, b.sort_order||0).run();
  return json({ id: r.meta.last_row_id });
});

router.put('/admin/api/products/:id', async (req, env, p) => {
  const b = await req.json();
  await env.DB.prepare(`
    UPDATE products SET name=?, description=?, category=?, fulfillment_type=?,
    special_order=?, active=?, sort_order=? WHERE id=?
  `).bind(b.name, b.description, b.category, b.fulfillment_type,
      b.special_order, b.active, b.sort_order, p.id).run();
  return json({ ok: true });
});

router.delete('/admin/api/products/:id', async (req, env, p) => {
  await env.DB.prepare('UPDATE products SET active = 0 WHERE id = ?').bind(p.id).run();
  return json({ ok: true });
});

// ── Variants ──────────────────────────────────────────────────────────────────

router.get('/admin/api/variants/:product_id', async (req, env, p) => {
  const rows = await env.DB.prepare(
    'SELECT v.*, i.on_hand FROM variants v LEFT JOIN inventory i ON i.variant_id = v.id WHERE v.product_id = ?'
  ).bind(p.product_id).all();
  return json(rows.results);
});

router.post('/admin/api/variants', async (req, env) => {
  const b = await req.json();
  const r = await env.DB.prepare(`
    INSERT INTO variants (product_id, sku, barcode, size, color, price_cents, image_key, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(b.product_id, b.sku||null, b.barcode||null, b.size||null, b.color||null,
      b.price_cents||null, b.image_key||null, b.active??1).run();
  const id = r.meta.last_row_id;
  // Create inventory row for stocked products
  const product = await env.DB.prepare('SELECT fulfillment_type FROM products WHERE id = ?').bind(b.product_id).first();
  if (product?.fulfillment_type === 'stocked') {
    await env.DB.prepare('INSERT OR IGNORE INTO inventory (variant_id, on_hand) VALUES (?, 0)').bind(id).run();
  }
  return json({ id });
});

router.put('/admin/api/variants/:id', async (req, env, p) => {
  const b = await req.json();
  await env.DB.prepare(`
    UPDATE variants SET sku=?, barcode=?, size=?, color=?, price_cents=?, image_key=?, active=? WHERE id=?
  `).bind(b.sku, b.barcode, b.size, b.color, b.price_cents, b.image_key, b.active, p.id).run();
  return json({ ok: true });
});

router.delete('/admin/api/variants/:id', async (req, env, p) => {
  await env.DB.prepare('UPDATE variants SET active = 0 WHERE id = ?').bind(p.id).run();
  return json({ ok: true });
});

// ── Inventory & Barcode Scanning ──────────────────────────────────────────────

router.get('/admin/api/inventory', async (req, env) => {
  const rows = await env.DB.prepare(`
    SELECT v.id, v.product_id, v.barcode, v.sku, v.size, v.color, v.price_cents,
           p.name AS product_name, p.fulfillment_type,
           COALESCE(i.on_hand, 0) AS on_hand, COALESCE(i.low_stock_threshold, 2) AS low_stock_threshold
    FROM variants v
    JOIN products p ON p.id = v.product_id
    LEFT JOIN inventory i ON i.variant_id = v.id
    WHERE v.active = 1 AND p.active = 1 AND p.fulfillment_type = 'stocked'
    ORDER BY p.sort_order, p.name, v.size
  `).all();
  return json(rows.results);
});

router.post('/admin/api/inventory/scan', async (req, env) => {
  const b = await req.json();
  const { barcode, mode, staff } = b; // mode: 'check_in' | 'take_out'
  if (!barcode || !mode) return json({ error: 'barcode and mode required' }, 400);

  const variant = await env.DB.prepare(
    'SELECT v.*, p.name AS product_name FROM variants v JOIN products p ON p.id = v.product_id WHERE v.barcode = ?'
  ).bind(barcode).first();

  if (!variant) return json({ unknown: true, barcode }, 404);

  const delta = mode === 'check_in' ? 1 : -1;
  const reason = mode === 'check_in' ? 'received' : 'in_person_sale';

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO inventory_movements (variant_id, delta, reason, source, staff)
      VALUES (?, ?, ?, 'scan', ?)
    `).bind(variant.id, delta, reason, staff || null),
    env.DB.prepare('UPDATE inventory SET on_hand = on_hand + ? WHERE variant_id = ?').bind(delta, variant.id),
  ]);

  const updated = await env.DB.prepare('SELECT on_hand FROM inventory WHERE variant_id = ?').bind(variant.id).first();
  return json({ ok: true, variant, on_hand: updated?.on_hand ?? 0 });
});

router.post('/admin/api/inventory/map', async (req, env) => {
  const b = await req.json();
  await env.DB.prepare('UPDATE variants SET barcode = ? WHERE id = ?').bind(b.barcode, b.variant_id).run();
  return json({ ok: true });
});

router.get('/admin/api/inventory/movements', async (req, env) => {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const rows = await env.DB.prepare(`
    SELECT m.*, v.size, v.color, p.name AS product_name
    FROM inventory_movements m
    JOIN variants v ON v.id = m.variant_id
    JOIN products p ON p.id = v.product_id
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).bind(limit, offset).all();
  return json(rows.results);
});

// ── Orders ────────────────────────────────────────────────────────────────────

router.get('/admin/api/orders', async (req, env) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const query = status
    ? 'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?'
    : 'SELECT * FROM orders ORDER BY created_at DESC LIMIT ?';
  const rows = status
    ? await env.DB.prepare(query).bind(status, limit).all()
    : await env.DB.prepare(query).bind(limit).all();
  return json(rows.results);
});

router.get('/admin/api/orders/:id', async (req, env, p) => {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(p.id).first();
  if (!order) return json({ error: 'Not found' }, 404);
  const items = (await env.DB.prepare(
    'SELECT oi.*, oic.component_name, oic.chosen_size FROM order_items oi LEFT JOIN order_item_components oic ON oic.order_item_id = oi.id WHERE oi.order_id = ?'
  ).bind(p.id).all()).results;
  return json({ order, items });
});

router.post('/admin/api/orders/:id/status', async (req, env, p) => {
  const b = await req.json();
  const allowed = ['paid','in_production','ready','picked_up','canceled'];
  if (!allowed.includes(b.status)) return json({ error: 'Invalid status' }, 400);
  await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?').bind(b.status, p.id).run();
  return json({ ok: true });
});

// ── Made-to-Order Queue ───────────────────────────────────────────────────────

router.get('/admin/api/queue', async (req, env) => {
  const rows = await env.DB.prepare(`
    SELECT oi.*, o.student_name, o.location, o.instructor_name, o.contact_email,
           o.created_at AS order_date
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE (oi.fulfillment_type = 'made_to_order' OR oi.backordered = 1)
      AND o.status NOT IN ('picked_up','canceled')
    ORDER BY oi.produce_by ASC, o.created_at ASC
  `).all();

  // Attach bundle components
  const withComponents = await Promise.all(rows.results.map(async (item) => {
    const comps = (await env.DB.prepare(
      'SELECT * FROM order_item_components WHERE order_item_id = ?'
    ).bind(item.id).all()).results;
    return { ...item, components: comps };
  }));

  return json(withComponents);
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/admin/api/settings', async (req, env) => {
  return json(await env.DB.prepare('SELECT * FROM settings WHERE id = 1').first());
});

router.put('/admin/api/settings', async (req, env) => {
  const b = await req.json();
  await env.DB.prepare(`
    UPDATE settings SET allow_backorders=?, announcement_text=?, announcement_on=? WHERE id=1
  `).bind(b.allow_backorders ?? 1, b.announcement_text ?? null, b.announcement_on ?? 0).run();
  // Purge announcement cache
  if (env.CACHE) await env.CACHE.delete('settings:announcement');
  return json({ ok: true });
});

// ── Contact Form (public endpoint, Turnstile-gated) ───────────────────────────

router.post('/admin/api/contact', async (req, env) => {
  const b = await req.json();
  const { name, email, message, 'cf-turnstile-response': token } = b;
  if (!name || !email || !message) return json({ error: 'Missing fields' }, 400);

  // Verify Turnstile
  if (env.TURNSTILE_SECRET && token) {
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
    });
    const tsData = await tsRes.json();
    if (!tsData.success) return json({ error: 'Verification failed' }, 400);
  }

  // Send via Resend
  if (env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Kinney Karate Contact <contact@kinneykarate.com>',
        to: ['info@kinneykarate.com'],
        reply_to: email,
        subject: `Contact form: ${name}`,
        text: `From: ${name} <${email}>\n\n${message}`,
      }),
    });
  }

  return json({ ok: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' } });
    }
    return router.handle(request, env, ctx);
  },
};
