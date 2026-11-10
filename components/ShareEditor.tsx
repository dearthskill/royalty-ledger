'use client';

import { useEffect, useState } from 'react';
import type { Artist } from './api';

export type ShareRow = { id: number; share_pct: string };

// Cents avoid float drift: 33.33 + 33.33 + 33.34 is exactly 10000.
const cents = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? Math.round(parseFloat(v) * 100) : NaN);

// Editable list of (artist, percentage) rows with a live total. The database still has
// the final word: whatever it rejects is shown by the caller verbatim.
export function ShareEditor({ initial, artists, saveLabel, busy, onSave }: {
  initial: ShareRow[];
  artists: Artist[];
  saveLabel: string;
  busy?: boolean;
  onSave: (rows: ShareRow[]) => void;
}) {
  const [rows, setRows] = useState<ShareRow[]>(initial);
  useEffect(() => setRows(initial), [initial]);

  const values = rows.map(r => cents(r.share_pct));
  const invalid = values.some(v => Number.isNaN(v) || v <= 0 || v > 10000);
  const total = values.reduce((s, v) => s + (Number.isNaN(v) ? 0 : v), 0);
  const exact = !invalid && total === 10000;
  const used = new Set(rows.map(r => r.id));
  const free = artists.filter(a => !used.has(a.artist_id));

  const update = (i: number, patch: Partial<ShareRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      <table className="table">
        <thead><tr><th>Artist</th><th className="w-32">Share %</th><th className="w-10" /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select className="input" value={r.id} onChange={e => update(i, { id: Number(e.target.value) })}>
                  {artists.filter(a => a.artist_id === r.id || !used.has(a.artist_id)).map(a => (
                    <option key={a.artist_id} value={a.artist_id}>{a.name}{a.kind === 'group' ? ' (group)' : ''}</option>
                  ))}
                </select>
              </td>
              <td>
                <input className="input text-right" inputMode="decimal" value={r.share_pct}
                  aria-label="share percent" onChange={e => update(i, { share_pct: e.target.value })} />
              </td>
              <td>
                <button type="button" className="btn-secondary" aria-label="remove row"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={!free.length}
          onClick={() => setRows([...rows, { id: free[0].artist_id, share_pct: '' }])}>+ Add</button>
        <span data-testid="share-total"
          className={`rounded px-2 py-1 text-sm font-medium ${exact
            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
            : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>
          Total {(total / 100).toFixed(2)}% {exact ? '✓' : invalid ? '· check values' : `· ${((10000 - total) / 100).toFixed(2)}% ${total < 10000 ? 'missing' : 'too much'}`}
        </span>
        <button type="button" className="btn ml-auto" disabled={busy || invalid} onClick={() => onSave(rows)}>{saveLabel}</button>
      </div>
    </div>
  );
}
