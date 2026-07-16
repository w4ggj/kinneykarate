/**
 * Stripe Webhook Worker — handles checkout.session.completed.
 * - Verifies Stripe signature
 * - Writes order + items to D1
 * - Decrements stocked inventory (inventory_movements ledger)
 * - Enqueues made-to-order items (sets produce_by)
 * - Sends confirmation email via Resend
 */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    if (!await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET)) {
      return new Response('Bad signature', { status: 400 });
    }

    let event;
    try { event = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400 }); }

    if (event.type === 'checkout.session.completed') {
      await handleCheckout(event.data.object, env);
    }

    return new Response('ok');
  },
};

async function handleCheckout(session, env) {
  const orderId = session.metadata?.order_id;
  if (!orderId) { console.error('No order_id in metadata'); return; }

  // Fetch order items from the pending order (inserted by store-api at session creation)
  // Note: we use stripe session id to look up the order
  const order = await env.DB.prepare(
    'SELECT * FROM orders WHERE stripe_session_id = ?'
  ).bind(session.id).first();

  if (!order) { console.error('Order not found for session', session.id); return; }

  // Update order status and capture payment intent
  await env.DB.prepare(`
    UPDATE orders SET status = 'paid', stripe_payment_intent = ? WHERE id = ?
  `).bind(session.payment_intent, order.id).run();

  // Retrieve line items from Stripe to reconstruct what was purchased
  // (we stored order_items shape separately — fetch from D1 if pre-stored, else use session)
  // For now we rely on order_items already written by store-api
  const itemRows = (await env.DB.prepare(
    'SELECT * FROM order_items WHERE order_id = ?'
  ).bind(order.id).all()).results;

  const now = new Date();
  const produceBy = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  for (const item of itemRows) {
    if (item.fulfillment_type === 'stocked' && item.variant_id) {
      const inv = await env.DB.prepare(
        'SELECT on_hand FROM inventory WHERE variant_id = ?'
      ).bind(item.variant_id).first();
      const onHand = inv?.on_hand ?? 0;
      const backordered = onHand < item.qty ? 1 : 0;

      // Write inventory movement
      await env.DB.prepare(`
        INSERT INTO inventory_movements (variant_id, delta, reason, source, order_id)
        VALUES (?, ?, 'online_order', 'online_webhook', ?)
      `).bind(item.variant_id, -item.qty, order.id).run();

      // Update on_hand
      await env.DB.prepare(
        'UPDATE inventory SET on_hand = on_hand - ? WHERE variant_id = ?'
      ).bind(item.qty, item.variant_id).run();

      if (backordered) {
        await env.DB.prepare(
          'UPDATE order_items SET backordered = 1, produce_by = ? WHERE id = ?'
        ).bind(produceBy, item.id).run();
      }
    }

    if (item.fulfillment_type === 'made_to_order') {
      await env.DB.prepare(
        'UPDATE order_items SET produce_by = ? WHERE id = ?'
      ).bind(produceBy, item.id).run();
    }
  }

  // Update order status
  await env.DB.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").bind(order.id).run();

  // Send confirmation emails via Resend
  await sendEmails(order, itemRows, env);
}

async function sendEmails(order, items, env) {
  if (!env.RESEND_API_KEY) return;

  const itemLines = items.map(i =>
    `  • ${i.name_snapshot}${i.size ? ` (Size ${i.size})` : ''}${i.color ? ` / ${i.color}` : ''} × ${i.qty}` +
    (i.fulfillment_type === 'made_to_order' || i.backordered ? ` — ready ~${i.produce_by}` : ' — pickup next class')
  ).join('\n');

  const customerEmail = {
    from: 'Kinney Karate <orders@kinneykarate.com>',
    to: [order.contact_email],
    subject: `Order confirmed — Kinney Karate #${order.id.slice(0, 8).toUpperCase()}`,
    text: `Hi ${order.student_name},\n\nThanks for your order! Here's a summary:\n\n${itemLines}\n\nPickup: ${order.location} with ${order.instructor_name}\n\nTotal: $${((order.total_cents) / 100).toFixed(2)}\n\nQuestions? Reply to this email or contact your instructor.\n\n— Kinney Karate`,
  };

  const staffEmail = {
    from: 'Kinney Karate Orders <orders@kinneykarate.com>',
    to: ['orders@kinneykarate.com'],
    subject: `New order — ${order.student_name} → ${order.instructor_name} @ ${order.location}`,
    text: `New order received.\n\nStudent: ${order.student_name}\nEmail: ${order.contact_email}\nLocation: ${order.location}\nInstructor: ${order.instructor_name}\n\nItems:\n${itemLines}\n\nTotal: $${((order.total_cents) / 100).toFixed(2)}\nOrder ID: ${order.id}`,
  };

  for (const email of [customerEmail, staffEmail]) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(email),
    });
  }
}

/** Stripe webhook signature verification (HMAC-SHA256) */
async function verifyStripeSignature(payload, header, secret) {
  if (!secret || !header) return false;
  try {
    const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
    const timestamp = parts.t;
    const sig = parts.v1;
    const signed = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
    const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');
    return computed === sig;
  } catch { return false; }
}
