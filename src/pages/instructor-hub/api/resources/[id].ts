export const prerender = false;
import type { APIContext } from 'astro';

function authed(cookies: APIContext['cookies']) {
  return cookies.get('kk_instructor_session')?.value === 'authenticated';
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function PATCH({ params, request, cookies, locals }: APIContext) {
  if (!authed(cookies)) return json({ error: 'Unauthorized' }, 401);
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return json({ error: 'DB not available' }, 503);

  const body = await request.json() as any;
  const active = body.active ?? 1;

  await env.DB.prepare('UPDATE instructor_resources SET active = ? WHERE id = ?')
    .bind(active, params.id).run();

  return json({ ok: true });
}

export async function DELETE({ params, cookies, locals }: APIContext) {
  if (!authed(cookies)) return json({ error: 'Unauthorized' }, 401);
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return json({ error: 'DB not available' }, 503);

  // Clean up R2 file if present
  const row: any = await env.DB.prepare(
    'SELECT r2_key FROM instructor_resources WHERE id = ?'
  ).bind(params.id).first();

  if (row?.r2_key && env.IMAGES) {
    await env.IMAGES.delete(row.r2_key).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM instructor_resources WHERE id = ?')
    .bind(params.id).run();

  return json({ ok: true });
}
