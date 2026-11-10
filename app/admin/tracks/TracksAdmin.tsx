'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Artist, type Track } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';

export function TracksAdmin() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, a] = await Promise.all([api<{ tracks: Track[] }>('/api/tracks'), api<{ artists: Artist[] }>('/api/artists')]);
      setTracks(t.tracks);
      setArtists(a.artists);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api('/api/tracks', { method: 'POST', body: {
        title: f.get('title'), isrc: f.get('isrc'), primary_artist_id: Number(f.get('primary_artist_id')),
        released_on: f.get('released_on') || null } });
      form.reset();
      setError(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const shown = tracks.filter(t => !filter || `${t.title} ${t.isrc} ${t.primary_artist_name}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tracks &amp; contracts</h1>
      <form onSubmit={create} className="card space-y-3">
        <div className="font-medium">New track</div>
        <div className="grid gap-3 sm:grid-cols-5">
          <div className="sm:col-span-2"><label className="label" htmlFor="t-title">Title</label><input id="t-title" name="title" required className="input" /></div>
          <div><label className="label" htmlFor="t-isrc">ISRC</label><input id="t-isrc" name="isrc" required placeholder="INABC2600009" className="input" /></div>
          <div><label className="label" htmlFor="t-artist">Primary artist</label>
            <select id="t-artist" name="primary_artist_id" className="input">
              {artists.map(a => <option key={a.artist_id} value={a.artist_id}>{a.name}</option>)}
            </select></div>
          <div><label className="label" htmlFor="t-date">Released</label><input id="t-date" name="released_on" type="date" className="input" /></div>
        </div>
        <button className="btn">Create track</button>
      </form>
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
                <td>{t.primary_artist_name}</td>
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
