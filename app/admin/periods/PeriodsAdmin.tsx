'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Period } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { StatusBadge } from '@/components/StatusBadge';

export function PeriodsAdmin() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPeriods((await api<{ periods: Period[] }>('/api/periods')).periods);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Overlapping dates, a duplicate label or ends_on <= starts_on are refused by PostgreSQL;
  // its message is shown as is.
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api('/api/periods', { method: 'POST', body: {
        label: f.get('label'), starts_on: f.get('starts_on'), ends_on: f.get('ends_on') } });
      form.reset();
      setError(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Payout periods</h1>
      <form onSubmit={create} className="card space-y-3">
        <div className="font-medium">New period</div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className="label" htmlFor="p-label">Label</label><input id="p-label" name="label" required placeholder="2026-10" className="input" /></div>
          <div><label className="label" htmlFor="p-start">Starts on</label><input id="p-start" name="starts_on" type="date" required className="input" /></div>
          <div><label className="label" htmlFor="p-end">Ends on</label><input id="p-end" name="ends_on" type="date" required className="input" /></div>
          <div className="flex items-end"><button className="btn">Create period</button></div>
        </div>
      </form>
      <ErrorBox error={error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Period</th><th>Dates</th><th>Status</th><th className="text-right">Tracks</th><th className="text-right">Plays</th><th className="text-right">Ledger</th><th className="text-right">Payouts</th></tr></thead>
          <tbody>
            {periods.map(p => (
              <tr key={p.period_id}>
                <td><Link className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={`/admin/periods/${p.period_id}`}>{p.label}</Link></td>
                <td className="text-xs">{p.starts_on} – {p.ends_on}</td>
                <td><StatusBadge status={p.status} /></td>
                <td className="text-right tabular-nums">{p.tracks_with_usage}</td>
                <td className="text-right tabular-nums">{Number(p.total_plays).toLocaleString()}</td>
                <td className="text-right tabular-nums">{p.ledger_total}</td>
                <td className="text-right tabular-nums">{p.payouts_total ? `${p.payout_total} (${p.payouts_paid}/${p.payouts_total} paid)` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
