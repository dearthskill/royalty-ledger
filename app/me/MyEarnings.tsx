'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Payout } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { StatusBadge } from '@/components/StatusBadge';

type Line = {
  period_id: number; period_label: string; track_id: number; title: string; platform_code: string;
  plays: number; effective_pct: string; amount: string; share_path: string;
};

// The API returns only this artist's rows (row-level security); the page never filters by artist itself.
export function MyEarnings() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [total, setTotal] = useState('0');
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ payouts: Payout[] }>('/api/me/payouts')
      .then(r => { setPayouts(r.payouts); if (r.payouts[0]) setPeriodId(r.payouts[0].period_id); })
      .catch(e => setError(e.message));
  }, []);

  const loadStatement = useCallback(async () => {
    try {
      const r = await api<{ lines: Line[]; total: string }>(`/api/me/statement${periodId ? `?period_id=${periodId}` : ''}`);
      setLines(r.lines); setTotal(r.total);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [periodId]);
  useEffect(() => { loadStatement(); }, [loadStatement]);

  const paid = useMemo(() => payouts.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0), [payouts]);
  const pending = useMemo(() => payouts.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0), [payouts]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My earnings</h1>
      <ErrorBox error={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card"><div className="label">Paid to you</div><div className="text-2xl font-semibold tabular-nums">{paid.toFixed(2)}</div></div>
        <div className="card"><div className="label">Pending</div><div className="text-2xl font-semibold tabular-nums">{pending.toFixed(2)}</div></div>
        <div className="card"><div className="label">Periods with earnings</div><div className="text-2xl font-semibold tabular-nums">{payouts.length}</div></div>
      </div>

      <section className="card space-y-2 overflow-x-auto">
        <div className="font-medium">Payouts</div>
        <table className="table">
          <thead><tr><th>Period</th><th className="text-right">Amount</th><th>Status</th><th>Paid at</th><th></th></tr></thead>
          <tbody>
            {payouts.map(p => (
              <tr key={p.payout_id} className={p.period_id === periodId ? 'bg-indigo-50 dark:bg-indigo-950' : ''}>
                <td>{p.period_label}</td><td className="text-right tabular-nums">{p.amount}</td>
                <td><StatusBadge status={p.status} /></td><td>{p.paid_at ? new Date(p.paid_at).toLocaleString() : '–'}</td>
                <td><button className="btn-secondary" onClick={() => setPeriodId(p.period_id)}>Statement</button></td>
              </tr>
            ))}
            {!payouts.length && <tr><td colSpan={5} className="text-slate-500">No payouts yet.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card space-y-2 overflow-x-auto">
        <div className="flex flex-wrap items-center gap-3">
          <div className="font-medium">Statement {periodId ? payouts.find(p => p.period_id === periodId)?.period_label : '(all periods)'}</div>
          <button className="btn-secondary" onClick={() => setPeriodId(null)}>All periods</button>
        </div>
        <table className="table text-sm">
          <thead><tr><th>Period</th><th>Track</th><th>Platform</th><th className="text-right">Plays</th><th className="text-right">Your share</th><th className="text-right">Amount</th><th>How your share is reached</th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}><td>{l.period_label}</td><td>{l.title}</td><td>{l.platform_code}</td>
                <td className="text-right tabular-nums">{l.plays.toLocaleString()}</td>
                <td className="text-right tabular-nums">{Number(l.effective_pct).toFixed(2)}%</td>
                <td className="text-right tabular-nums">{l.amount}</td><td className="text-xs text-slate-500">{l.share_path}</td></tr>
            ))}
            <tr><td colSpan={5} className="font-medium">Total</td><td className="text-right font-medium tabular-nums">{total}</td><td></td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
