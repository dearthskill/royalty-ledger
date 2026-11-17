// Browser-side fetch helper: JSON in/out; throws the API's `error` text so screens can show it verbatim.
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // FormData (file uploads) is sent as multipart; the browser sets the boundary header itself.
  const form = opts.body instanceof FormData;
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined && !form ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body === undefined ? undefined : form ? (opts.body as FormData) : JSON.stringify(opts.body),
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

// A v_period_totals row (GET /api/periods). Sums are strings (NUMERIC / SUM(bigint)).
export type Period = {
  period_id: number; label: string; starts_on: string; ends_on: string; status: 'open' | 'closed'; closed_at: string | null;
  tracks_with_usage: number; total_plays: string; ledger_total: string; payout_total: string; payouts_paid: number; payouts_total: number;
};
export type Payout = {
  payout_id: number; period_id: number; period_label: string; artist_id: number; artist_name: string;
  amount: string; status: 'pending' | 'paid'; paid_at: string | null;
};
