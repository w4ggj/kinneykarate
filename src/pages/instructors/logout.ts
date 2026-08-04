export const prerender = false;
import type { APIContext } from 'astro';

export async function GET({ cookies, redirect }: APIContext) {
  cookies.delete('kk_instructor_session', { path: '/instructors' });
  return redirect('/instructors/');
}
