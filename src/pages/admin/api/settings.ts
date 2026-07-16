export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../lib/adminAuth';

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  const row = await env.DB.prepare('SELECT * FROM settings WHERE id = 1').first();
  return new Response(JSON.stringify(row), { headers: { 'Content-Type': 'application/json' } });
}

export async function PUT({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);

  let body: any;
  try { body = await request.json(); } catch { return err('Invalid JSON', 400); }

  const { allow_backorders, announcement_on, announcement_text } = body;

  await env.DB.prepare(`
    UPDATE settings SET
      allow_backorders = COALESCE(?, allow_backorders),
      announcement_on = COALESCE(?, announcement_on),
      announcement_text = COALESCE(?, announcement_text)
    WHERE id = 1
  `).bind(
    allow_backorders ?? null,
    announcement_on ?? null,
    announcement_text ?? null,
  ).run();

  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

function err(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } });
}
