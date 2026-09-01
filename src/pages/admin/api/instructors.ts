export const prerender = false;
import type { APIContext } from 'astro';
import { checkAdminAuth, unauthorizedResponse } from '../../../lib/adminAuth';

export async function GET({ locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const rows = (await env.DB.prepare('SELECT * FROM instructors ORDER BY name ASC').all()).results;
  return json(rows);
}

export async function POST({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const { name, email } = await request.json() as any;
  if (!name?.trim() || !email?.trim()) return err('name and email required');
  const result = await env.DB.prepare('INSERT INTO instructors (name, email) VALUES (?, ?) RETURNING id').bind(name.trim(), email.trim()).first() as any;
  return json({ id: result.id, name: name.trim(), email: email.trim(), active: 1 });
}

export async function PUT({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const { id, name, email, active } = await request.json() as any;
  if (!id) return err('id required');
  await env.DB.prepare('UPDATE instructors SET name=COALESCE(?,name), email=COALESCE(?,email), active=COALESCE(?,active) WHERE id=?')
    .bind(name ?? null, email ?? null, active ?? null, id).run();
  return json({ ok: true });
}

export async function DELETE({ request, locals, cookies }: APIContext) {
  if (!checkAdminAuth(locals, cookies)) return unauthorizedResponse();
  const env = (locals as any).runtime?.env;
  if (!env?.DB) return err('No DB', 503);
  const { id } = await request.json() as any;
  if (!id) return err('id required');
  await env.DB.prepare('DELETE FROM instructors WHERE id=?').bind(id).run();
  return json({ ok: true });
}

function json(data: any) { return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }); }
function err(msg: string, status = 400) { return new Response(JSON.stringify({ error: msg }), { status, headers: { 'Content-Type': 'application/json' } }); }
