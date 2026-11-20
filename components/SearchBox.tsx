'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from './api';

type Result = { kind: 'track' | 'artist'; id: number; label: string };

// Catalogue search (full-text, prefix match) with results linking to the admin screens.
export function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const t = setTimeout(() => {
      api<{ results: Result[] }>(`/api/search?q=${encodeURIComponent(q)}`).then(r => setResults(r.results)).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative w-56">
      <input className="input" placeholder="Search tracks, artists…" value={q} onChange={e => setQ(e.target.value)} aria-label="search catalogue" />
      {results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white text-sm shadow dark:border-slate-700 dark:bg-slate-900">
          {results.map(r => (
            <li key={`${r.kind}-${r.id}`}>
              <Link onClick={() => setQ('')} className="block px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                href={r.kind === 'track' ? `/admin/tracks/${r.id}` : `/admin/artists/${r.id}`}>
                <span className="mr-2 text-xs uppercase text-slate-400">{r.kind}</span>{r.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
