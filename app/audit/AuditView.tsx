'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Payout, type Period } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { StatusBadge } from '@/components/StatusBadge';

type Audit = {
  audit_id: number; table_name: string; op: 'INSERT' | 'UPDATE' | 'DELETE'; row_pk: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; actor: string; at: string;
};
type Entry = {
  entry_id: number; title: string; artist_name: string; platform_code: string;
  plays: number; effective_pct: string; amount: string; share_path: string;
};

const TABLES = ['contract', 'contract_split', 'group_member', 'payout', 'payout_period'];
const OP_STYLE = { INSERT: 'text-emerald-700 dark:text-emerald-400', UPDATE: 'text-amber-700 dark:text-amber-400', DELETE: 'text-red-700 dark:text-red-400' };

// Keys whose value differs between before and after (all keys for INSERT / DELETE).
function changedKeys(a: Audit) {
  const keys = new Set([...Object.keys(a.before ?? {}), ...Object.keys(a.after ?? {})]);
  return [...keys].filter(k => JSON.stringify(a.before?.[k]) !== JSON.stringify(a.after?.[k]));
}

export function AuditView() {
  const [tab, setTab] = useState<'audit' | 'ledger'>('audit');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Ledger &amp; audit</h1>
        <span className="text-xs text-slate-500">read-only</span>
        <div className="ml-auto flex gap-2">
          <button className={tab === 'audit' ? 'btn' : 'btn-secondary'} onClick={() => setTab('audit')}>Audit trail</button>
          <button className={tab === 'ledger' ? 'btn' : 'btn-secondary'} onClick={() => setTab('ledger')}>Ledger &amp; payouts</button>
        </div>
      </div>
      {tab === 'audit' ? <AuditTrail /> : <LedgerTab />}
    </div>
  );
}

function AuditTrail() {
  const [entries, setEntries] = useState<Audit[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({ limit: '100' });
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: Record<string, string>) => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v.trim() !== '')).toString();
    try {
      setEntries((await api<{ entries: Audit[] }>(`/api/audit?${qs}`)).entries);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load({ limit: '100' }); }, [load]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <div className="space-y-4">
      <form className="card grid gap-3 sm:grid-cols-7" onSubmit={e => { e.preventDefault(); load(filters); }}>
        <div><label className="label" htmlFor="f-table">Table</label>
          <select id="f-table" className="input" value={filters.table ?? ''} onChange={set('table')}>
            <option value="">all</option>{TABLES.map(t => <option key={t}>{t}</option>)}
          </select></div>
        <div><label className="label" htmlFor="f-pk">Row key</label><input id="f-pk" className="input" placeholder="e.g. 9 or 9/3" value={filters.row_pk ?? ''} onChange={set('row_pk')} /></div>
        <div><label className="label" htmlFor="f-actor">Actor</label><input id="f-actor" className="input" placeholder="admin@" value={filters.actor ?? ''} onChange={set('actor')} /></div>
        <div><label className="label" htmlFor="f-from">From</label><input id="f-from" type="date" className="input" value={filters.from ?? ''} onChange={set('from')} /></div>
        <div><label className="label" htmlFor="f-to">To</label><input id="f-to" type="date" className="input" value={filters.to ?? ''} onChange={set('to')} /></div>
        <div><label className="label" htmlFor="f-limit">Limit</label><input id="f-limit" type="number" min={1} max={500} className="input" value={filters.limit ?? ''} onChange={set('limit')} /></div>
        <div className="flex items-end gap-2">
          <button className="btn">Filter</button>
          <button type="button" className="btn-secondary" onClick={() => { setFilters({ limit: '100' }); load({ limit: '100' }); }}>Reset</button>
        </div>
      </form>
      <ErrorBox error={error} />
      <div className="card overflow-x-auto">
        <table className="table text-sm">
          <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Table</th><th>Op</th><th>Row</th><th>Changed</th></tr></thead>
          <tbody>
            {entries.map(a => (
              <FragmentRow key={a.audit_id} a={a} open={open === a.audit_id} toggle={() => setOpen(open === a.audit_id ? null : a.audit_id)} />
            ))}
            {!entries.length && <tr><td colSpan={7} className="text-slate-500">No entries match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FragmentRow({ a, open, toggle }: { a: Audit; open: boolean; toggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800" onClick={toggle}>
        <td className="tabular-nums text-slate-500">{a.audit_id}</td>
        <td className="whitespace-nowrap">{new Date(a.at).toLocaleString()}</td>
        <td>{a.actor}</td>
        <td className="font-mono text-xs">{a.table_name}</td>
        <td className={`font-medium ${OP_STYLE[a.op]}`}>{a.op}</td>
        <td className="font-mono text-xs">{a.row_pk}</td>
        <td className="text-xs">{open ? '▾' : '▸'} {changedKeys(a).join(', ')}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><div className="label">Before</div><pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{a.before ? JSON.stringify(a.before, null, 2) : '–'}</pre></div>
              <div><div className="label">After</div><pre className="overflow-x-auto rounded bg-slate-100 p-2 text-xs dark:bg-slate-800">{a.after ? JSON.stringify(a.after, null, 2) : '–'}</pre></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function LedgerTab() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ periods: Period[] }>('/api/periods').then(r => {
      setPeriods(r.periods);
      const closed = r.periods.find(p => p.status === 'closed');
      if (closed) setPeriodId(closed.period_id);
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!periodId) return;
    Promise.all([
      api<{ entries: Entry[] }>(`/api/periods/${periodId}/ledger`),
      api<{ payouts: Payout[] }>(`/api/payouts?period_id=${periodId}`),
    ]).then(([l, p]) => { setEntries(l.entries); setPayouts(p.payouts); setError(null); })
      .catch(e => setError(e.message));
  }, [periodId]);

  const period = periods.find(p => p.period_id === periodId);
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="l-period">Period</label>
          <select id="l-period" className="input" value={periodId ?? ''} onChange={e => setPeriodId(Number(e.target.value))}>
            {periods.map(p => <option key={p.period_id} value={p.period_id}>{p.label} ({p.status})</option>)}
          </select></div>
        {period && <div className="text-sm text-slate-500">ledger total {period.ledger_total} · payouts {period.payout_total} ({period.payouts_paid}/{period.payouts_total} paid)</div>}
      </div>
      <ErrorBox error={error} />
      <section className="card space-y-2 overflow-x-auto">
        <div className="font-medium">Payouts</div>
        <table className="table">
          <thead><tr><th>Artist</th><th className="text-right">Amount</th><th>Status</th><th>Paid at</th></tr></thead>
          <tbody>
            {payouts.map(p => <tr key={p.payout_id}><td>{p.artist_name}</td><td className="text-right tabular-nums">{p.amount}</td><td><StatusBadge status={p.status} /></td><td>{p.paid_at ? new Date(p.paid_at).toLocaleString() : '–'}</td></tr>)}
            {!payouts.length && <tr><td colSpan={4} className="text-slate-500">No payouts (period not closed yet).</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card space-y-2 overflow-x-auto">
        <div className="font-medium">Ledger entries ({entries.length})</div>
        <table className="table text-sm">
          <thead><tr><th>Track</th><th>Platform</th><th>Payee</th><th className="text-right">Plays</th><th className="text-right">Share %</th><th className="text-right">Amount</th><th>Share path</th></tr></thead>
          <tbody>{entries.map(e => (
            <tr key={e.entry_id}><td>{e.title}</td><td>{e.platform_code}</td><td>{e.artist_name}</td>
              <td className="text-right tabular-nums">{e.plays}</td><td className="text-right tabular-nums">{Number(e.effective_pct).toFixed(2)}</td>
              <td className="text-right tabular-nums">{e.amount}</td><td className="text-xs text-slate-500">{e.share_path}</td></tr>
          ))}</tbody>
        </table>
      </section>
    </div>
  );
}
