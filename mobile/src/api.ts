import * as SecureStore from 'expo-secure-store';
import { API_BASE } from './config';

const TOKEN_KEY = 'kk_token';
const EMAIL_KEY = 'kk_email';

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/api/terminal/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as any;
  if (!res.ok) {
    throw new Error(data.error ?? 'Login failed');
  }
  await SecureStore.setItemAsync(TOKEN_KEY, data.access_token);
  await SecureStore.setItemAsync(EMAIL_KEY, data.user?.email ?? email);
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(EMAIL_KEY);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function getEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(EMAIL_KEY);
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function getConnectionToken(): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/api/terminal/connection-token`, {
    method: 'POST',
    headers,
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(data.error ?? 'Failed to get connection token');
  return data.secret as string;
}

export async function createPaymentIntent(
  amount_cents: number,
  description: string
): Promise<{ id: string; client_secret: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/admin/api/terminal/payment-intent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ amount_cents, description }),
  });
  const data = await res.json() as any;
  if (!res.ok) throw new Error(data.error ?? 'Failed to create payment intent');
  return { id: data.id, client_secret: data.client_secret };
}

export interface ProductVariant {
  id: number;
  size: string | null;
  color: string | null;
  price_cents: number;
  on_hand: number;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  kind: string;
  fulfillment_type: string;
  price_cents: number | null;
  variants: ProductVariant[];
}

export async function getProducts(): Promise<Product[]> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/admin/api/terminal/products`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json() as any;
    throw new Error(data.error ?? 'Failed to fetch products');
  }
  return res.json() as Promise<Product[]>;
}
