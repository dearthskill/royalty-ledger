'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type Artist } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';

// Artist list. Each name opens the artist's profile (members, tracks, new track with contributors).
export function ArtistsAdmin() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setArtists((await api<{ artists: Artist[] }>('/api/artists')).artists);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Artists &amp; groups</h1>
      <CreateArtist onCreated={load} />
      <ErrorBox error={error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Kind</th><th>E-mail</th><th /></tr></thead>
          <tbody>
            {artists.map(a => <ArtistRow key={a.artist_id} artist={a} onChanged={load} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateArtist({ onCreated }: { onCreated: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api('/api/artists', { method: 'POST', body: { name: f.get('name'), kind: f.get('kind'), email: f.get('email') || null } });
      form.reset();
      setError(null);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="font-medium">New artist or group</div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div><label className="label" htmlFor="new-name">Name</label><input id="new-name" name="name" required className="input" /></div>
        <div><label className="label" htmlFor="new-kind">Kind</label>
          <select id="new-kind" name="kind" className="input"><option value="solo">solo</option><option value="group">group</option></select></div>
        <div><label className="label" htmlFor="new-email">E-mail (optional)</label><input id="new-email" name="email" type="email" className="input" /></div>
        <div className="flex items-end"><button className="btn">Create</button></div>
      </div>
      <ErrorBox error={error} />
    </form>
  );
}

function ArtistRow({ artist, onChanged }: { artist: Artist; onChanged: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    try {
      await api(`/api/artists/${artist.artist_id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <tr>
        <td><Link className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={`/admin/artists/${artist.artist_id}`}>{artist.name}</Link></td>
        <td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{artist.kind}</span></td>
        <td className="text-slate-500">{artist.email ?? '–'}</td>
        <td className="whitespace-nowrap text-right">
          <span className="inline-flex gap-2">
            <Link className="btn-secondary" href={`/admin/artists/${artist.artist_id}`}>Profile</Link>
            {confirmDelete
              ? <><button className="btn-danger" onClick={remove}>Really delete</button><button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Keep</button></>
              : <button className="btn-secondary" onClick={() => setConfirmDelete(true)}>Delete</button>}
          </span>
        </td>
      </tr>
      {error && <tr><td colSpan={4}><ErrorBox error={error} /></td></tr>}
    </>
  );
}
