export const prerender = false;
import type { APIContext } from 'astro';

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  let body: any;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { barcode, variant_id } = body;
  if (!barcode || !variant_id) return err('barcode and variant_id required', 400);

  await env.DB.prepare('UPDATE variants SET barcode = ? WHERE id = ?').bind(barcode, variant_id).run();

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
