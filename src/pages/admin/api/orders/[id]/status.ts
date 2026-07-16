export const prerender = false;
import type { APIContext } from 'astro';

const VALID_STATUSES = ['paid', 'in_production', 'ready', 'picked_up', 'canceled'];

export async function POST({ params, request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  let body: any;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { status } = body;
  if (!VALID_STATUSES.includes(status)) return err('Invalid status', 400);

  const result = await env.DB.prepare('UPDATE orders SET status = ? WHERE id = ?')
    .bind(status, params.id).run();

  if (!result.meta.changes) return err('Order not found', 404);

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
