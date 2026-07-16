export const prerender = false;
import type { APIContext } from 'astro';

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  const b = await request.json() as any;
  const { name, email, message } = b;
  const token = b['cf-turnstile-response'];

  if (!name || !email || !message) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (env?.TURNSTILE_SECRET && token) {
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token }),
    });
    const tsData = await tsRes.json() as any;
    if (!tsData.success) return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (env?.RESEND_API_KEY) {
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

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
