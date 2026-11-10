// Helpers for calling route handlers directly, without a running server.
import { NextRequest } from 'next/server';
import { POST as login } from '@/app/api/auth/login/route';

export const PASSWORD = 'Password@123';
// `never` lets handlers with any params type be passed in (parameters are contravariant).
type Handler = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;

export function request(path: string, opts: { method?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(new URL(path, 'http://localhost'), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export async function call(handler: Handler, path: string,
  opts: { method?: string; cookie?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const res = await handler(request(path, opts), { params: Promise.resolve(opts.params ?? {}) as Promise<never> });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

// Logs in through the real login route and returns the Cookie header for later calls.
const cache = new Map<string, string>();
export async function cookieFor(email: string): Promise<string> {
  if (!cache.has(email)) {
    const res = await login(request('/api/auth/login', { method: 'POST', body: { email, password: PASSWORD } }));
    if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status}`);
    cache.set(email, res.headers.get('set-cookie')!.split(';')[0]);
  }
  return cache.get(email)!;
}

export const ADMIN = 'admin@royalty.test';
export const AUDITOR = 'auditor@royalty.test';
export const NOVA = 'nova@royalty.test';   // artist 1
export const MIRA = 'mira@royalty.test';   // artist 3
