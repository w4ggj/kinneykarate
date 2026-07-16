export function checkAdminAuth(locals: any, cookies: any): boolean {
  const env = (locals as any).runtime?.env;
  const adminUser = env?.ADMIN_USER || 'admin';
  const adminPass = env?.ADMIN_PASS || '';
  if (!adminPass) return false;
  const session = cookies.get('kk_admin_session');
  return session?.value === `${adminUser}:${adminPass}`;
}

export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
