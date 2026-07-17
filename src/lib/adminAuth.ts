export function checkAdminAuth(_locals: any, cookies: any): boolean {
  const session = cookies.get('kk_admin_session');
  return session?.value === 'authenticated';
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
