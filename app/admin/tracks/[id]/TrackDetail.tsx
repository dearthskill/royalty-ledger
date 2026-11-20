'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Artist, type Track } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { ShareEditor, type ShareRow } from '@/components/ShareEditor';

type Split = { artist_id: number; name: string; kind: string; share_pct: string };
type Contract = {
  contract_id: number; version: number; status: 'draft' | 'active' | 'superseded';
  activated_at: string | null; created_at: string; total_share_pct: string; splits: Split[];
};
type Effective = { contract_id: number; version: number; split: { artist_id: number; name: string; effective_pct: string; share_path: string }[] };
type Audit = { audit_id: number; table_name: string; op: string; row_pk: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; actor: string; at: string };

const STATUS_STYLE: Record<Contract['status'], string> = {
  draft: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  superseded: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '–');

export function TrackDetail({ id }: { id: number }) {
  const [track, setTrack] = useState<Track | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [effective, setEffective] = useState<Effective | null>(null);
  const [effectiveError, setEffectiveError] = useState<string | null>(null);
  const [history, setHistory] = useState<Audit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c, a, h] = await Promise.all([
        api<{ track: Track }>(`/api/tracks/${id}`),
        api<{ contracts: Contract[] }>(`/api/tracks/${id}/contracts`),
        api<{ artists: Artist[] }>('/api/artists'),
        api<{ entries: Audit[] }>(`/api/tracks/${id}/history`),
      ]);
      setTrack(t.track); setContracts(c.contracts); setArtists(a.artists); setHistory(h.entries);
    } catch (e) {
      setError((e as Error).message);
    }
    try {
      setEffective(await api<Effective>(`/api/tracks/${id}/effective-split`));
      setEffectiveError(null);
    } catch (e) {
      setEffective(null);
      setEffectiveError((e as Error).message);   // e.g. "Track 8 has no active contract"
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Runs one action; any API/database error is shown verbatim, then everything is reloaded.
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  }

  const names = useMemo(() => new Map(artists.map(a => [a.artist_id, a.name])), [artists]);
  const draft = contracts.find(c => c.status === 'draft');
  const draftRows = useMemo<ShareRow[]>(() => (draft?.splits ?? []).map(s => ({ id: s.artist_id, share_pct: s.share_pct })), [draft]);

  if (!track) return <div className="space-y-2"><ErrorBox error={error} /><div className="text-sm text-slate-500">{error ? '' : 'Loading…'}</div></div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/tracks" className="text-sm text-indigo-700 hover:underline dark:text-indigo-300">← Tracks</Link>
        <h1 className="text-2xl font-semibold">{track.title}</h1>
        <div className="text-sm text-slate-500">
          <span className="font-mono">{track.isrc}</span> ·{' '}
          <Link className="hover:underline" href={`/admin/artists/${track.primary_artist_id}`}>{track.primary_artist_name}</Link> · released {track.released_on ?? '–'}
        </div>
      </div>

      <ErrorBox error={error} />

      <section className="card space-y-2">
        <h2 className="font-medium">Effective split{effective ? ` (active contract v${effective.version})` : ''}</h2>
        <p className="text-sm text-slate-500">Groups expanded down to the artists who are actually paid (recursive query in the database).</p>
        {effective ? (
          <table className="table">
            <thead><tr><th>Artist</th><th className="text-right">Effective %</th><th>How</th></tr></thead>
            <tbody>
              {effective.split.map(s => (
                <tr key={s.share_path}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-right font-mono">{Number(s.effective_pct).toFixed(2)}</td>
                  <td className="text-slate-500">{s.share_path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <ErrorBox error={effectiveError} />}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Contract versions</h2>
          {!draft && (
            <button className="btn" disabled={busy}
              onClick={() => act(() => api(`/api/tracks/${id}/contracts`, { method: 'POST' }))}>
              New draft version
            </button>
          )}
        </div>

        {draft && (
          <div className="card space-y-3 border-amber-300 dark:border-amber-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">v{draft.version}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE.draft}`}>draft</span>
              <span className="text-sm text-slate-500">Edit freely; activation needs exactly 100% and replaces the active version.</span>
            </div>
            <ShareEditor initial={draftRows} artists={artists} saveLabel="Save splits" busy={busy}
              onSave={rows => act(() => api(`/api/contracts/${draft.contract_id}/splits`, {
                method: 'PUT', body: { splits: rows.map(r => ({ artist_id: r.id, share_pct: r.share_pct })) } }))} />
            <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              <button className="btn" disabled={busy}
                onClick={() => act(() => api(`/api/contracts/${draft.contract_id}/activate`, { method: 'POST' }))}>
                Activate saved splits (total {Number(draft.total_share_pct).toFixed(2)}%)
              </button>
              <button className="btn-danger" disabled={busy}
                onClick={() => act(() => api(`/api/contracts/${draft.contract_id}`, { method: 'DELETE' }))}>
                Delete draft
              </button>
            </div>
          </div>
        )}

        {contracts.filter(c => c.status !== 'draft').map(c => (
          <div key={c.contract_id} className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">v{c.version}</span>
              <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[c.status]}`}>{c.status}</span>
              <span className="text-sm text-slate-500">activated {when(c.activated_at)}</span>
            </div>
            <table className="table">
              <tbody>
                {c.splits.map(s => (
                  <tr key={s.artist_id}>
                    <td>{s.name}{s.kind === 'group' && <span className="ml-1 text-xs text-slate-400">(group)</span>}</td>
                    <td className="w-24 text-right font-mono">{Number(s.share_pct).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {!contracts.length && <div className="text-sm text-slate-500">No contracts yet. Create a draft to define the split.</div>}
      </section>

      <section className="card space-y-2">
        <h2 className="font-medium">History</h2>
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Change</th></tr></thead>
          <tbody>
            {history.slice(0, 25).map(h => (
              <tr key={h.audit_id}>
                <td className="whitespace-nowrap text-slate-500">{when(h.at)}</td>
                <td>{h.actor}</td>
                <td>{describe(h, names)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function describe(h: Audit, names: Map<number, string>): string {
  const row = (h.after ?? h.before) as Record<string, unknown>;
  const who = names.get(Number(row.artist_id)) ?? `artist ${row.artist_id}`;
  if (h.table_name === 'contract') {
    if (h.op === 'INSERT') return `created contract v${row.version} (draft)`;
    if (h.op === 'DELETE') return `deleted draft v${row.version}`;
    return `contract v${row.version}: ${h.before?.status} → ${h.after?.status}`;
  }
  const pct = (r: Record<string, unknown> | null) => (r ? `${Number(r.share_pct).toFixed(2)}%` : '');
  if (h.op === 'INSERT') return `${who} set to ${pct(h.after)} (contract ${row.contract_id})`;
  if (h.op === 'DELETE') return `${who} removed (contract ${row.contract_id})`;
  return `${who}: ${pct(h.before)} → ${pct(h.after)} (contract ${row.contract_id})`;
}
