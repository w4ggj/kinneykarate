export const prerender = false;
import type { APIContext } from 'astro';

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  const body = await request.text();
  const sig = request.headers.get('stripe-signature') ?? '';

  if (!await verifyStripeSignature(body, sig, env?.STRIPE_WEBHOOK_SECRET ?? '')) {
    return new Response('Bad signature', { status: 400 });
  }

  const event = JSON.parse(body);
  if (event.type === 'checkout.session.completed' && env?.DB) {
    await handleCheckout(event.data.object, env);
  }

  return new Response('ok');
}

async function handleCheckout(session: any, env: any) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').bind(session.id).first() as any;
  if (!order) return;

  await env.DB.prepare("UPDATE orders SET status='paid', stripe_payment_intent=? WHERE id=?")
    .bind(session.payment_intent, order.id).run();

  const items = (await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(order.id).all()).results as any[];
  const produceBy = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  for (const item of items) {
    if (item.fulfillment_type === 'stocked' && item.variant_id) {
      const inv = await env.DB.prepare('SELECT on_hand FROM inventory WHERE variant_id = ?').bind(item.variant_id).first() as any;
      const backordered = (inv?.on_hand ?? 0) < item.qty ? 1 : 0;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO inventory_movements (variant_id,delta,reason,source,order_id) VALUES (?,?,\'online_order\',\'online_webhook\',?)').bind(item.variant_id, -item.qty, order.id),
        env.DB.prepare('UPDATE inventory SET on_hand = on_hand - ? WHERE variant_id = ?').bind(item.qty, item.variant_id),
      ]);
      if (backordered) await env.DB.prepare('UPDATE order_items SET backordered=1, produce_by=? WHERE id=?').bind(produceBy, item.id).run();
    }
    if (item.fulfillment_type === 'made_to_order') {
      await env.DB.prepare('UPDATE order_items SET produce_by=? WHERE id=?').bind(produceBy, item.id).run();
    }
  }

  // Send emails via Resend
  if (env.RESEND_API_KEY) {
    const itemLines = items.map((i: any) =>
      `  • ${i.name_snapshot}${i.size ? ` (Size ${i.size})` : ''}${i.color ? ` / ${i.color}` : ''} × ${i.qty}` +
      (i.fulfillment_type === 'made_to_order' || i.backordered ? ` — ready ~${i.produce_by}` : ' — pickup next class')
    ).join('\n');

    for (const email of [
      { to: order.contact_email, subject: `Order confirmed — Kinney Karate #${order.id.slice(0,8).toUpperCase()}`, text: `Hi ${order.student_name},\n\nYour order is confirmed:\n\n${itemLines}\n\nPickup: ${order.location} with ${order.instructor_name}\nTotal: $${(order.total_cents/100).toFixed(2)}\n\n— Kinney Karate` },
      { to: 'orders@kinneykarate.com', subject: `New order — ${order.student_name} → ${order.instructor_name} @ ${order.location}`, text: `Student: ${order.student_name}\nEmail: ${order.contact_email}\nLocation: ${order.location}\nInstructor: ${order.instructor_name}\n\nItems:\n${itemLines}\n\nTotal: $${(order.total_cents/100).toFixed(2)}\nOrder ID: ${order.id}` },
    ]) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Kinney Karate <orders@kinneykarate.com>', ...email }),
      });
    }
  }
}

async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  if (!secret || !header) return false;
  try {
    const parts = Object.fromEntries(header.split(',').map(p => p.split('=')));
    const signed = `${parts.t}.${payload}`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
    const computed = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2,'0')).join('');
    return computed === parts.v1;
  } catch { return false; }
}
