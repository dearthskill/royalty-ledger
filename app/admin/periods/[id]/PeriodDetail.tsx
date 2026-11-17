'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Payout, type Period } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { StatusBadge } from '@/components/StatusBadge';

type Counts = { events: number; plays: number };
type Note = { at: string; kind: string; text: string };
type Batch = {
  batch_id: string; platform: string; source_file: string; uploaded_at: string; row_count: number;
  status: string; notes: Note[]; counts: { valid: Counts; void: Counts };
};
type Platform = { code: string; name: string };
type DupGroup = { track_id: number; platform: string; listener_hash: string; played_at: string; count: number };
type Flagged = { platform: string; listener_hash: string; hour: string; plays: number };
type AggRow = { track_id: number; title: string; platform: string; plays: number };
type Entry = {
  entry_id: number; title: string; artist_id: number; artist_name: string; platform_code: string;
  plays: number; effective_pct: string; amount: string; share_path: string;
};
type RowError = { row: number; message: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '–');

export function PeriodDetail({ id }: { id: number }) {
  const [period, setPeriod] = useState<Period | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [ledger, setLedger] = useState<Entry[]>([]);
  const [dups, setDups] = useState<{ groups: DupGroup[]; extra_rows: number } | null>(null);
  const [flagged, setFlagged] = useState<Flagged[] | null>(null);
  const [maxPerHour, setMaxPerHour] = useState(20);
  const [agg, setAgg] = useState<{ rows: AggRow[]; total_plays: number; written: boolean } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, b, pl, po] = await Promise.all([
        api<{ period: Period }>(`/api/periods/${id}`),
        api<{ batches: Batch[] }>(`/api/usage/batches?period_id=${id}`),
        api<{ platforms: Platform[] }>('/api/platforms'),
        api<{ payouts: Payout[] }>(`/api/payouts?period_id=${id}`),
      ]);
      setPeriod(p.period); setBatches(b.batches); setPlatforms(pl.platforms); setPayouts(po.payouts);
      if (p.period.status === 'closed') setLedger((await api<{ entries: Entry[] }>(`/api/periods/${id}/ledger`)).entries);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Runs one action; shows its result or the API/database error verbatim, then reloads.
  async function act(fn: () => Promise<string | void>) {
    setBusy(true);
    setRowErrors([]);
    try {
      const msg = await fn();
      setInfo(msg || null);
      setError(null);
    } catch (e) {
      setInfo(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
      load();
    }
  }

  // Upload: a 400 lists every invalid row; the whole file is rejected.
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = new FormData(form);
    setBusy(true);
    try {
      const res = await fetch(`/api/periods/${id}/usage/import`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        setRowErrors(Array.isArray(data.details) ? data.details : []);
        setInfo(null);
      } else {
        setError(null); setRowErrors([]);
        setInfo(`Stored batch ${data.batch_id} with ${data.row_count} rows`);
        form.reset();
      }
    } finally {
      setBusy(false);
      load();
    }
  }

  const note = (b: string) => notes[b]?.trim() ?? '';
  const scope = (b?: string) => (b ? `?batch_id=${b}` : '');

  if (!period) return <div className="space-y-2"><ErrorBox error={error} /><div className="text-sm text-slate-500">{error ? '' : 'Loading…'}</div></div>;
  const open = period.status === 'open';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/periods" className="text-sm text-indigo-700 hover:underline dark:text-indigo-300">← Periods</Link>
        <h1 className="flex items-center gap-3 text-2xl font-semibold">Period {period.label} <StatusBadge status={period.status} /></h1>
        <div className="text-sm text-slate-500">
          {period.starts_on} – {period.ends_on} · {Number(period.total_plays).toLocaleString()} plays in usage_summary
          {period.closed_at && <> · closed {when(period.closed_at)}</>}
        </div>
      </div>

      <ErrorBox error={error} />
      {rowErrors.length > 0 && (
        <div className="error max-h-48 overflow-y-auto">
          <ul className="list-disc pl-5">{rowErrors.map(r => <li key={r.row}>Row {r.row}: {r.message}</li>)}</ul>
        </div>
      )}
      {info && <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{info}</div>}

      {open && (
        <form onSubmit={upload} className="card space-y-3">
          <div className="font-medium">1. Upload a usage report (CSV or JSON)</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div><label className="label" htmlFor="u-platform">Platform</label>
              <select id="u-platform" name="platform" className="input">
                {platforms.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="u-file">File</label>
              <input id="u-file" name="file" type="file" accept=".csv,.json" required className="input" /></div>
            <div className="flex items-end"><button className="btn" disabled={busy}>Upload</button></div>
          </div>
          <div className="text-xs text-slate-500">Columns: track_id, plays, listener_hash, played_at (ISO), device (optional); other columns are kept in raw.</div>
        </form>
      )}

      <section className="card space-y-3 overflow-x-auto">
        <div className="font-medium">{open && "2. "}Batches (MongoDB usage_batches)</div>
        <table className="table">
          <thead><tr><th>File</th><th>Platform</th><th>Status</th><th className="text-right">Rows</th><th className="text-right">Valid plays</th><th className="text-right">Void events</th><th>Notes</th>{open && <th>Actions</th>}</tr></thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.batch_id} className="align-top">
                <td><div className="font-medium">{b.source_file}</div><div className="font-mono text-xs text-slate-500">{b.batch_id}</div></td>
                <td>{b.platform}</td>
                <td><StatusBadge status={b.status} /></td>
                <td className="text-right tabular-nums">{b.row_count}</td>
                <td className="text-right tabular-nums">{b.counts.valid.plays}</td>
                <td className="text-right tabular-nums">{b.counts.void.events}</td>
                <td className="max-w-xs text-xs">{b.notes.map((n, i) => <div key={i}><span className="font-medium">{n.kind}</span>: {n.text}</div>)}</td>
                {open && (
                  <td className="space-y-1">
                    {b.status !== 'aggregated' && (
                      <div className="flex gap-1">
                        <input className="input w-40" placeholder="note" aria-label={`note for ${b.source_file}`}
                          value={notes[b.batch_id] ?? ''} onChange={e => setNotes({ ...notes, [b.batch_id]: e.target.value })} />
                        {b.status === 'disputed'
                          ? <button className="btn-secondary" disabled={busy || !note(b.batch_id)}
                              onClick={() => act(async () => { await api(`/api/usage/batches/${b.batch_id}/resolve`, { method: 'POST', body: { note: note(b.batch_id) } }); setNotes({ ...notes, [b.batch_id]: '' }); return 'Dispute resolved'; })}>Resolve</button>
                          : <button className="btn-secondary" disabled={busy || !note(b.batch_id)}
                              onClick={() => act(async () => { await api(`/api/usage/batches/${b.batch_id}/dispute`, { method: 'POST', body: { note: note(b.batch_id) } }); setNotes({ ...notes, [b.batch_id]: '' }); return 'Batch disputed'; })}>Dispute</button>}
                      </div>
                    )}
                    {b.counts.void.events > 0 && (
                      <button className="btn-danger" disabled={busy}
                        onClick={() => act(async () => `Purged ${(await api<{ deleted: number }>(`/api/periods/${id}/usage/voided${scope(b.batch_id)}`, { method: 'DELETE' })).deleted} voided events`)}>
                        Purge voided</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!batches.length && <tr><td colSpan={8} className="text-slate-500">No batches uploaded.</td></tr>}
          </tbody>
        </table>
      </section>

      {open && (
        <section className="card space-y-4">
          <div className="font-medium">3. Clean the period</div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={busy}
                onClick={() => act(async () => { setDups(await api(`/api/periods/${id}/usage/duplicates`)); })}>Preview duplicates</button>
              <button className="btn" disabled={busy}
                onClick={() => act(async () => { const r = await api<{ voided: number }>(`/api/periods/${id}/usage/void-duplicates`, { method: 'POST', body: {} }); setDups(null); return `Voided ${r.voided} duplicate events`; })}>Void duplicates</button>
            </div>
            {dups && (
              <div className="text-sm">
                <div>{dups.groups.length} groups, {dups.extra_rows} extra rows would be voided (the first copy of each is kept).</div>
                <table className="table mt-1">
                  <thead><tr><th>Track</th><th>Platform</th><th>Listener</th><th>Played at</th><th className="text-right">Copies</th></tr></thead>
                  <tbody>{dups.groups.slice(0, 10).map((g, i) => (
                    <tr key={i}><td>{g.track_id}</td><td>{g.platform}</td><td className="font-mono text-xs">{g.listener_hash}</td><td>{when(g.played_at)}</td><td className="text-right">{g.count}</td></tr>
                  ))}</tbody>
                </table>
                {dups.groups.length > 10 && <div className="text-xs text-slate-500">…and {dups.groups.length - 10} more</div>}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div><label className="label" htmlFor="max-ph">Max plays / listener / hour</label>
                <input id="max-ph" type="number" min={1} className="input w-28" value={maxPerHour} onChange={e => setMaxPerHour(Number(e.target.value))} /></div>
              <button className="btn-secondary" disabled={busy}
                onClick={() => act(async () => { setFlagged((await api<{ listeners: Flagged[] }>(`/api/periods/${id}/usage/flagged?max_per_hour=${maxPerHour}`)).listeners); })}>Preview bot plays</button>
              <button className="btn" disabled={busy}
                onClick={() => act(async () => { const r = await api<{ voided: number; listeners: number }>(`/api/periods/${id}/usage/void-flagged`, { method: 'POST', body: { max_per_hour: maxPerHour } }); setFlagged(null); return `Voided ${r.voided} events from ${r.listeners} listener-hours`; })}>Void bot plays</button>
            </div>
            {flagged && (
              <table className="table text-sm">
                <thead><tr><th>Platform</th><th>Listener</th><th>Hour</th><th className="text-right">Plays</th></tr></thead>
                <tbody>
                  {flagged.map((f, i) => <tr key={i}><td>{f.platform}</td><td className="font-mono text-xs">{f.listener_hash}</td><td>{when(f.hour)}</td><td className="text-right">{f.plays}</td></tr>)}
                  {!flagged.length && <tr><td colSpan={4} className="text-slate-500">No listener over the threshold.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          <button className="btn-danger" disabled={busy}
            onClick={() => act(async () => `Purged ${(await api<{ deleted: number }>(`/api/periods/${id}/usage/voided`, { method: 'DELETE' })).deleted} voided events`)}>
            Purge all voided events</button>
        </section>
      )}

      {open && (
        <section className="card space-y-3">
          <div className="font-medium">4. Aggregate into usage_summary, then close</div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={busy}
              onClick={() => act(async () => { setAgg(await api(`/api/periods/${id}/aggregate`, { method: 'POST', body: { preview: true } })); })}>Preview aggregate</button>
            <button className="btn" disabled={busy}
              onClick={() => act(async () => { const r = await api<{ rows: AggRow[]; total_plays: number; written: boolean }>(`/api/periods/${id}/aggregate`, { method: 'POST', body: {} }); setAgg(r); return `Wrote ${r.rows.length} usage_summary rows (${r.total_plays} plays)`; })}>Write usage summary</button>
            <button className="btn-danger" disabled={busy}
              onClick={() => act(async () => { const r = await api<{ payouts: Payout[] }>(`/api/periods/${id}/close`, { method: 'POST' }); setAgg(null); return `Period closed: ${r.payouts.length} payouts created`; })}>Close period</button>
          </div>
          {agg && (
            <table className="table text-sm">
              <thead><tr><th>Track</th><th>Platform</th><th className="text-right">Plays</th></tr></thead>
              <tbody>
                {agg.rows.map(r => <tr key={`${r.track_id}-${r.platform}`}><td>{r.title}</td><td>{r.platform}</td><td className="text-right tabular-nums">{r.plays}</td></tr>)}
                <tr><td colSpan={2} className="font-medium">Total {agg.written ? '(written)' : '(preview, not written)'}</td><td className="text-right font-medium tabular-nums">{agg.total_plays}</td></tr>
              </tbody>
            </table>
          )}
        </section>
      )}

      {!open && (
        <section className="card space-y-2 overflow-x-auto">
          <div className="font-medium">Ledger ({ledger.length} entries, total {period.ledger_total})</div>
          <table className="table text-sm">
            <thead><tr><th>Track</th><th>Platform</th><th>Payee</th><th className="text-right">Plays</th><th className="text-right">Share %</th><th className="text-right">Amount</th><th>Share path</th></tr></thead>
            <tbody>{ledger.map(e => (
              <tr key={e.entry_id}><td>{e.title}</td><td>{e.platform_code}</td><td>{e.artist_name}</td>
                <td className="text-right tabular-nums">{e.plays}</td><td className="text-right tabular-nums">{Number(e.effective_pct).toFixed(2)}</td>
                <td className="text-right tabular-nums">{e.amount}</td><td className="text-xs text-slate-500">{e.share_path}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}

      {payouts.length > 0 && (
        <section className="card space-y-2 overflow-x-auto">
          <div className="font-medium">Payouts</div>
          <table className="table">
            <thead><tr><th>Artist</th><th className="text-right">Amount</th><th>Status</th><th>Paid at</th><th></th></tr></thead>
            <tbody>{payouts.map(p => (
              <tr key={p.payout_id}><td>{p.artist_name}</td><td className="text-right tabular-nums">{p.amount}</td>
                <td><StatusBadge status={p.status} /></td><td>{when(p.paid_at)}</td>
                <td>{p.status === 'pending' && (
                  <button className="btn" disabled={busy}
                    onClick={() => act(async () => { await api(`/api/payouts/${p.payout_id}/pay`, { method: 'POST' }); return `Paid ${p.artist_name} ${p.amount}`; })}>Pay</button>
                )}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
