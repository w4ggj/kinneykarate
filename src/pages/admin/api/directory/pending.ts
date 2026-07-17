export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../../lib/adminAuth';

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const rows = (await env.DB.prepare(
    `SELECT id, business_name, owner_name, category, description, phone, email, website, city, zip, created_at
     FROM business_listings WHERE approved = 0 ORDER BY created_at ASC`
  ).all()).results;
  return json(rows);
}

export async function POST({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const { id, action } = await request.json() as any;
  if (!id || !['approve','reject'].includes(action)) return err('Invalid');
  if (action === 'approve') {
    await env.DB.prepare(`UPDATE business_listings SET approved = 1 WHERE id = ?`).bind(id).run();
  } else {
    await env.DB.prepare(`DELETE FROM business_listings WHERE id = ?`).bind(id).run();
  }
  return json({ ok: true });
}

function json(d: any) { return new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }); }
function err(msg: string, status = 400) { return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } }); }
