export const prerender = false;
import type { APIContext } from 'astro';

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  if (!env?.SUPABASE_URL || !env?.SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { email, password } = body;
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'email and password required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supaRes = await fetch(
    `${env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    }
  );

  const data = await supaRes.json() as any;

  if (!supaRes.ok) {
    return new Response(
      JSON.stringify({ error: data.error_description ?? data.msg ?? 'Authentication failed' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      access_token: data.access_token,
      user: { email: data.user?.email ?? email },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
