'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Artist } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { ShareEditor, type ShareRow } from '@/components/ShareEditor';

type Member = { member_id: number; name: string; kind: string; share_pct: string };

export function ArtistsAdmin() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setArtists((await api<{ artists: Artist[] }>('/api/artists')).artists);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // open the group named in the URL hash (links from the search box)
  useEffect(() => {
    const m = window.location.hash.match(/^#artist-(\d+)$/);
    if (m) setOpen(Number(m[1]));
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Artists &amp; groups</h1>
      <CreateArtist onCreated={load} />
      <ErrorBox error={error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Name</th><th>Kind</th><th>E-mail</th><th /></tr></thead>
          <tbody>
            {artists.map(a => (
              <ArtistRow key={a.artist_id} artist={a} artists={artists} open={open === a.artist_id}
                onToggle={() => setOpen(open === a.artist_id ? null : a.artist_id)} onChanged={load} />
            ))}
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

function ArtistRow({ artist, artists, open, onToggle, onChanged }: {
  artist: Artist; artists: Artist[]; open: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api(`/api/artists/${artist.artist_id}`, { method: 'PATCH', body: { name: f.get('name'), email: f.get('email') || null } });
      setEditing(false);
      setError(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }
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
      <tr id={`artist-${artist.artist_id}`}>
        {editing ? (
          <td colSpan={3}>
            <form onSubmit={save} className="flex flex-wrap gap-2">
              <input name="name" defaultValue={artist.name} className="input max-w-xs" aria-label="name" />
              <input name="email" type="email" defaultValue={artist.email ?? ''} className="input max-w-xs" aria-label="e-mail" />
              <button className="btn">Save</button>
              <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
            </form>
          </td>
        ) : (
          <>
            <td className="font-medium">{artist.name}</td>
            <td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">{artist.kind}</span></td>
            <td className="text-slate-500">{artist.email ?? '–'}</td>
          </>
        )}
        <td className="whitespace-nowrap text-right">
          <span className="inline-flex gap-2">
            {artist.kind === 'group' && <button className="btn-secondary" onClick={onToggle}>{open ? 'Hide members' : 'Members'}</button>}
            {!editing && <button className="btn-secondary" onClick={() => setEditing(true)}>Edit</button>}
            {confirmDelete
              ? <><button className="btn-danger" onClick={remove}>Really delete</button><button className="btn-secondary" onClick={() => setConfirmDelete(false)}>Keep</button></>
              : <button className="btn-secondary" onClick={() => setConfirmDelete(true)}>Delete</button>}
          </span>
        </td>
      </tr>
      {error && <tr><td colSpan={4}><ErrorBox error={error} /></td></tr>}
      {open && artist.kind === 'group' && (
        <tr><td colSpan={4} className="bg-slate-50 dark:bg-slate-950"><MembersEditor group={artist} artists={artists} /></td></tr>
      )}
    </>
  );
}

function MembersEditor({ group, artists }: { group: Artist; artists: Artist[] }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers((await api<{ members: Member[] }>(`/api/artists/${group.artist_id}/members`)).members);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [group.artist_id]);
  useEffect(() => { load(); }, [load]);

  const initial = useMemo<ShareRow[]>(() => (members ?? []).map(m => ({ id: m.member_id, share_pct: m.share_pct })), [members]);
  const candidates = useMemo(() => artists.filter(a => a.artist_id !== group.artist_id), [artists, group.artist_id]);

  async function save(rows: ShareRow[]) {
    setBusy(true);
    setSaved(false);
    try {
      const r = await api<{ members: Member[] }>(`/api/artists/${group.artist_id}/members`, {
        method: 'PUT', body: { members: rows.map(r => ({ member_id: r.id, share_pct: r.share_pct })) } });
      setMembers(r.members);
      setError(null);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);   // e.g. "Member shares of group 5 total 99 percent, must be exactly 100"
    } finally {
      setBusy(false);
    }
  }

  if (!members) return <div className="text-sm text-slate-500">Loading members…</div>;
  return (
    <div className="space-y-2 py-2">
      <div className="text-sm text-slate-500">Members of {group.name}. Shares must total exactly 100%; a group may contain other groups.</div>
      <ShareEditor initial={initial} artists={candidates} saveLabel="Save members" busy={busy} onSave={save} />
      <ErrorBox error={error} />
      {saved && <div className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</div>}
    </div>
  );
}
