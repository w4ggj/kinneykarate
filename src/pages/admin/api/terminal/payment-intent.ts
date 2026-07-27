export const prerender = false;
import type { APIContext } from 'astro';
import { checkBearerAuth } from '../../../../lib/bearerAuth';

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;

  if (!(await checkBearerAuth(request, env))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env?.STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { amount_cents?: number; description?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { amount_cents, description } = body;
  if (!amount_cents || typeof amount_cents !== 'number' || amount_cents <= 0) {
    return new Response(JSON.stringify({ error: 'amount_cents must be a positive number' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const params = new URLSearchParams();
  params.append('amount', String(Math.round(amount_cents)));
  params.append('currency', 'usd');
  params.append('payment_method_types[]', 'card_present');
  params.append('capture_method', 'automatic');
  if (description) params.append('description', description);

  const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await stripeRes.json() as any;

  if (!stripeRes.ok) {
    return new Response(
      JSON.stringify({ error: data.error?.message ?? 'Failed to create payment intent' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ id: data.id, client_secret: data.client_secret }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
