'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Artist } from '@/components/api';
import { ErrorBox } from '@/components/ErrorBox';
import { ShareEditor, type ShareRow } from '@/components/ShareEditor';

type Member = { member_id: number; name: string; kind: string; share_pct: string };

// Group member editor. PUT replaces the whole set in one transaction; the database checks the
// 100% total (deferred trigger) and cycles, and its message is shown verbatim.
export function MembersEditor({ group, artists }: { group: Artist; artists: Artist[] }) {
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
