'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Track } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';

export function TracksAdmin() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTracks((await api<{ tracks: Track[] }>('/api/tracks')).tracks);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = tracks.filter(t => !filter || `${t.title} ${t.isrc} ${t.primary_artist_name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tracks &amp; contracts</h1>
      <p className="text-sm text-slate-500">
        To add a track, open the artist&apos;s profile under <Link className="text-indigo-700 hover:underline dark:text-indigo-300" href="/admin/artists">Artists</Link>:
        the track and its contributing artists are created there.
      </p>
      <ErrorBox error={error} />
      <div className="card space-y-3 overflow-x-auto">
        <input className="input max-w-xs" placeholder="Filter this list…" value={filter} onChange={e => setFilter(e.target.value)} aria-label="filter tracks" />
        <table className="table">
          <thead><tr><th>Title</th><th>ISRC</th><th>Primary artist</th><th>Released</th><th>Active contract</th></tr></thead>
          <tbody>
            {shown.map(t => (
              <tr key={t.track_id}>
                <td><Link className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={`/admin/tracks/${t.track_id}`}>{t.title}</Link></td>
                <td className="font-mono text-xs">{t.isrc}</td>
                <td><Link className="hover:underline" href={`/admin/artists/${t.primary_artist_id}`}>{t.primary_artist_name}</Link></td>
                <td>{t.released_on ?? '–'}</td>
                <td>{t.active_version ? `v${t.active_version}` : <span className="text-amber-700 dark:text-amber-400">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
