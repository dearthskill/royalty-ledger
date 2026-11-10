// Browser-side fetch helper: JSON in/out; throws the API's `error` text so screens can show it verbatim.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export type Artist = { artist_id: number; name: string; kind: 'solo' | 'group'; email: string | null };
export type Track = {
  track_id: number; title: string; isrc: string; primary_artist_id: number; primary_artist_name: string;
  released_on: string | null; active_version: number | null;
};
export type Share = { id: number; name: string; kind?: string; share_pct: string };
