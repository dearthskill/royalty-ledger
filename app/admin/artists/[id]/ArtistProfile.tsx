'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Artist } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { ShareEditor, type ShareRow } from '@/components/ShareEditor';
import { MembersEditor } from '../MembersEditor';

type ProfileTrack = {
  track_id: number; title: string; isrc: string; released_on: string | null; primary_artist_name: string;
  role: 'primary' | 'contributor'; contract_version: number | null; contract_status: 'draft' | 'active' | null; share_pct: string | null;
};
type Created = { track: { track_id: number; title: string }; contract: { version: number; status: string } };

// One artist's page: details, group members, their tracks, and "add a track" with contributing artists.
export function ArtistProfile({ id }: { id: number }) {
  const [artist, setArtist] = useState<Artist | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tracks, setTracks] = useState<ProfileTrack[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, all, t] = await Promise.all([
        api<{ artist: Artist }>(`/api/artists/${id}`),
        api<{ artists: Artist[] }>('/api/artists'),
        api<{ tracks: ProfileTrack[] }>(`/api/artists/${id}/tracks`),
      ]);
      setArtist(a.artist); setArtists(all.artists); setTracks(t.tracks);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!artist) return <div className="space-y-2"><ErrorBox error={error} /><div className="text-sm text-slate-500">{error ? '' : 'Loading…'}</div></div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/artists" className="text-sm text-indigo-700 hover:underline dark:text-indigo-300">← Artists</Link>
        <ArtistHeader artist={artist} onSaved={setArtist} />
      </div>
      <ErrorBox error={error} />

      {artist.kind === 'group' && (
        <section className="card space-y-2">
          <h2 className="font-medium">Members</h2>
          <MembersEditor group={artist} artists={artists.filter(a => a.artist_id !== artist.artist_id)} />
        </section>
      )}

      <NewTrack artist={artist} artists={artists} onCreated={load} />

      <section className="card space-y-2 overflow-x-auto">
        <h2 className="font-medium">Tracks</h2>
        {tracks.length === 0 ? <div className="text-sm text-slate-500">No tracks yet.</div> : (
          <table className="table">
            <thead><tr><th>Title</th><th>ISRC</th><th>Role</th><th className="text-right">Share</th><th>Contract</th><th>Released</th></tr></thead>
            <tbody>
              {tracks.map(t => (
                <tr key={t.track_id}>
                  <td><Link className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={`/admin/tracks/${t.track_id}`}>{t.title}</Link></td>
                  <td className="font-mono text-xs">{t.isrc}</td>
                  <td>{t.role === 'primary' ? 'primary artist' : `contributor (primary: ${t.primary_artist_name})`}</td>
                  <td className="text-right font-mono">{t.share_pct ? `${Number(t.share_pct).toFixed(2)}%` : '–'}</td>
                  <td>{t.contract_version ? `v${t.contract_version} ${t.contract_status}` : <span className="text-amber-700 dark:text-amber-400">none</span>}</td>
                  <td>{t.released_on ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ArtistHeader({ artist, onSaved }: { artist: Artist; onSaved: (a: Artist) => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      const r = await api<{ artist: Artist }>(`/api/artists/${artist.artist_id}`, { method: 'PATCH', body: { name: f.get('name'), email: f.get('email') || null } });
      onSaved(r.artist);
      setEditing(false);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="mt-1 flex flex-wrap gap-2">
        <input name="name" defaultValue={artist.name} className="input max-w-xs" aria-label="name" />
        <input name="email" type="email" defaultValue={artist.email ?? ''} className="input max-w-xs" aria-label="e-mail" placeholder="e-mail (optional)" />
        <button className="btn">Save</button>
        <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
        <div className="w-full"><ErrorBox error={error} /></div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-semibold">{artist.name}</h1>
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{artist.kind}</span>
      <span className="text-sm text-slate-500">{artist.email ?? 'no e-mail'}</span>
      <button className="btn-secondary ml-auto" onClick={() => setEditing(true)}>Edit</button>
    </div>
  );
}

// New track with this artist as primary artist. The contributors table starts with the artist at 100%;
// add other artists (or groups) and adjust the shares. Everything is saved in one transaction.
function NewTrack({ artist, artists, onCreated }: { artist: Artist; artists: Artist[]; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [isrc, setIsrc] = useState('');
  const [releasedOn, setReleasedOn] = useState('');
  const [activate, setActivate] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const initial = useMemo<ShareRow[]>(() => [{ id: artist.artist_id, share_pct: '100' }], [artist.artist_id]);

  async function save(rows: ShareRow[]) {
    setBusy(true);
    setCreated(null);
    try {
      const r = await api<Created>(`/api/artists/${artist.artist_id}/tracks`, { method: 'POST', body: {
        title, isrc, released_on: releasedOn || null, activate,
        splits: rows.map(r => ({ artist_id: r.id, share_pct: r.share_pct })) } });
      setCreated(r);
      setError(null);
      setTitle(''); setIsrc(''); setReleasedOn('');
      setResetKey(k => k + 1);   // fresh contributors table
      onCreated();
    } catch (e) {
      setError((e as Error).message);   // e.g. "Splits of contract 12 total 90 percent, must be exactly 100"
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-medium">Add a track for {artist.name}</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><label className="label" htmlFor="t-title">Title</label>
          <input id="t-title" value={title} onChange={e => setTitle(e.target.value)} className="input" /></div>
        <div><label className="label" htmlFor="t-isrc">ISRC</label>
          <input id="t-isrc" value={isrc} onChange={e => setIsrc(e.target.value)} placeholder="INABC2600009" className="input" /></div>
        <div><label className="label" htmlFor="t-date">Released</label>
          <input id="t-date" type="date" value={releasedOn} onChange={e => setReleasedOn(e.target.value)} className="input" /></div>
      </div>
      <div>
        <div className="label">Contributing artists and their shares</div>
        <ShareEditor key={resetKey} initial={initial} artists={artists} saveLabel="Create track" busy={busy} onSave={save} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={activate} onChange={e => setActivate(e.target.checked)} />
        Activate the split now (the database requires exactly 100%); untick to keep it as a draft
      </label>
      <ErrorBox error={error} />
      {created && (
        <div className="text-sm text-emerald-700 dark:text-emerald-400">
          Created <Link className="underline" href={`/admin/tracks/${created.track.track_id}`}>{created.track.title}</Link> with
          contract v{created.contract.version} ({created.contract.status}).
        </div>
      )}
    </section>
  );
}
