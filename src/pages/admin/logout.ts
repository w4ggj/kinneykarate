export const prerender = false;
import type { APIContext } from 'astro';

export async function GET({ cookies, redirect }: APIContext) {
  cookies.delete('kk_admin_session', { path: '/admin' });
  return redirect('/admin');
}
