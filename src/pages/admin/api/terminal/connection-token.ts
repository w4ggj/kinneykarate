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

  const stripeRes = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: '',
  });

  const data = await stripeRes.json() as any;

  if (!stripeRes.ok) {
    return new Response(
      JSON.stringify({ error: data.error?.message ?? 'Failed to create connection token' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({ secret: data.secret }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
