import { describe, it, expect, beforeAll } from 'vitest';
import * as artists from '@/app/api/artists/route';
import * as artist from '@/app/api/artists/[id]/route';
import * as members from '@/app/api/artists/[id]/members/route';
import * as tracks from '@/app/api/tracks/route';
import * as track from '@/app/api/tracks/[id]/route';
import { GET as search } from '@/app/api/search/route';
import { ADMIN, AUDITOR, MIRA, call, cookieFor } from '../helpers';

let admin: string, auditor: string, mira: string;
beforeAll(async () => {
  [admin, auditor, mira] = await Promise.all([cookieFor(ADMIN), cookieFor(AUDITOR), cookieFor(MIRA)]);
});

describe('artists', () => {
  it('GET lists artists for any role, filtered by kind', async () => {
    const all = await call(artists.GET, '/api/artists', { cookie: mira });
    expect(all.status).toBe(200);
    expect(all.body.artists.map((a: { name: string }) => a.name)).toContain('The Night Owls');
    const groups = await call(artists.GET, '/api/artists?kind=group', { cookie: auditor });
    expect(groups.body.artists.map((a: { name: string }) => a.name)).toEqual(['Owl Beats Collective', 'The Night Owls']);
    expect((await call(artists.GET, '/api/artists?kind=band', { cookie: admin })).status).toBe(400);
    expect((await call(artists.GET, '/api/artists')).status).toBe(401);
  });

  it('POST creates (admin only), validates, and reports duplicates verbatim', async () => {
    const r = await call(artists.POST, '/api/artists', { method: 'POST', cookie: admin, body: { name: 'Tara', kind: 'solo', email: 'TARA@royalty.test' } });
    expect(r.status).toBe(201);
    expect(r.body.artist).toMatchObject({ name: 'Tara', kind: 'solo', email: 'tara@royalty.test' });
    const dup = await call(artists.POST, '/api/artists', { method: 'POST', cookie: admin, body: { name: 'Tara', kind: 'solo' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/duplicate key value violates unique constraint "artist_name_key"/);
    expect((await call(artists.POST, '/api/artists', { method: 'POST', cookie: admin, body: { name: '', kind: 'duo' } })).status).toBe(400);
    expect((await call(artists.POST, '/api/artists', { method: 'POST', cookie: auditor, body: { name: 'X', kind: 'solo' } })).status).toBe(403);
  });

  it('GET/PATCH/DELETE by id', async () => {
    const created = (await call(artists.POST, '/api/artists', { method: 'POST', cookie: admin, body: { name: 'Temp Artist', kind: 'solo' } })).body.artist;
    const id = String(created.artist_id);
    expect((await call(artist.GET, `/api/artists/${id}`, { cookie: mira, params: { id } })).body.artist.name).toBe('Temp Artist');
    expect((await call(artist.GET, '/api/artists/9999', { cookie: mira, params: { id: '9999' } })).status).toBe(404);
    expect((await call(artist.GET, '/api/artists/abc', { cookie: mira, params: { id: 'abc' } })).status).toBe(404);

    const p = await call(artist.PATCH, `/api/artists/${id}`, { method: 'PATCH', cookie: admin, params: { id }, body: { name: 'Renamed', email: 'r@royalty.test' } });
    expect(p.body.artist).toMatchObject({ name: 'Renamed', email: 'r@royalty.test', kind: 'solo' });
    const cleared = await call(artist.PATCH, `/api/artists/${id}`, { method: 'PATCH', cookie: admin, params: { id }, body: { email: null } });
    expect(cleared.body.artist).toMatchObject({ name: 'Renamed', email: null });
    expect((await call(artist.PATCH, `/api/artists/${id}`, { method: 'PATCH', cookie: admin, params: { id }, body: { kind: 'group' } })).status).toBe(400);

    expect((await call(artist.DELETE, `/api/artists/${id}`, { method: 'DELETE', cookie: admin, params: { id } })).status).toBe(204);
    expect((await call(artist.DELETE, `/api/artists/${id}`, { method: 'DELETE', cookie: admin, params: { id } })).status).toBe(404);
    const inUse = await call(artist.DELETE, '/api/artists/1', { method: 'DELETE', cookie: admin, params: { id: '1' } });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error).toMatch(/violates foreign key constraint/);
  });
});

describe('group members', () => {
  it('GET lists members with total (admin, auditor); artists are refused', async () => {
    const r = await call(members.GET, '/api/artists/6/members', { cookie: auditor, params: { id: '6' } });
    expect(r.body).toEqual({
      members: [{ member_id: 2, name: 'Kai', kind: 'solo', share_pct: '60.00' }, { member_id: 4, name: 'Lina', kind: 'solo', share_pct: '40.00' }],
      total_pct: '100.00',
    });
    expect((await call(members.GET, '/api/artists/1/members', { cookie: admin, params: { id: '1' } })).status).toBe(409);
    expect((await call(members.GET, '/api/artists/6/members', { cookie: mira, params: { id: '6' } })).status).toBe(403);
  });

  it('PUT replaces the set atomically; the database rejects 99% and cycles', async () => {
    const g = (await call(artists.POST, '/api/artists', { method: 'POST', cookie: admin, body: { name: 'Trio Test', kind: 'group' } })).body.artist;
    const id = String(g.artist_id);
    const put = (body: unknown) => call(members.PUT, `/api/artists/${id}/members`, { method: 'PUT', cookie: admin, params: { id }, body });

    const ok = await put({ members: [{ member_id: 1, share_pct: 33.34 }, { member_id: 2, share_pct: '33.33' }, { member_id: 3, share_pct: 33.33 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.total_pct).toBe('100.00');

    const short = await put({ members: [{ member_id: 1, share_pct: 50 }, { member_id: 2, share_pct: 49 }] });
    expect(short.status).toBe(409);
    expect(short.body.error).toMatch(/total 99 percent, must be exactly 100/);
    // the failed PUT rolled back: the old set is still there
    const after = await call(members.GET, `/api/artists/${id}/members`, { cookie: admin, params: { id } });
    expect(after.body.members).toHaveLength(3);

    const cycle = await call(members.PUT, '/api/artists/6/members', { method: 'PUT', cookie: admin, params: { id: '6' },
      body: { members: [{ member_id: 5, share_pct: 100 }] } });
    expect(cycle.status).toBe(409);
    expect(cycle.body.error).toMatch(/membership cycle/);

    expect((await put({ members: [{ member_id: 1, share_pct: 50 }, { member_id: 1, share_pct: 50 }] })).status).toBe(400);
    expect((await put({ members: [{ member_id: 1, share_pct: 100.001 }] })).status).toBe(400);
    expect((await call(members.PUT, `/api/artists/${id}/members`, { method: 'PUT', cookie: auditor, params: { id }, body: { members: [] } })).status).toBe(403);
  });
});

describe('tracks', () => {
  it('GET lists tracks; active_version is shown to staff only', async () => {
    const staff = await call(tracks.GET, '/api/tracks', { cookie: auditor });
    const ms = staff.body.tracks.find((t: { title: string }) => t.title === 'Midnight Static');
    expect(ms).toMatchObject({ isrc: 'INABC2600001', primary_artist_name: 'The Night Owls', active_version: 2, released_on: '2026-03-14' });
    const art = await call(tracks.GET, '/api/tracks', { cookie: mira });
    expect(art.status).toBe(200);
    expect(art.body.tracks.every((t: { active_version: null }) => t.active_version === null)).toBe(true);
  });

  it('POST validates ISRC and artist; duplicates and unknown artists are 409', async () => {
    const body = { title: 'Test Song', isrc: 'inabc2600050', primary_artist_id: 3, released_on: '2026-10-01' };
    const r = await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: admin, body });
    expect(r.status).toBe(201);
    expect(r.body.track).toMatchObject({ title: 'Test Song', isrc: 'INABC2600050', primary_artist_name: 'Mira', active_version: null });
    expect((await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: admin, body })).status).toBe(409);
    expect((await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: admin, body: { ...body, isrc: 'BAD' } })).status).toBe(400);
    const noArtist = await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: admin, body: { ...body, isrc: 'INABC2600051', primary_artist_id: 999 } });
    expect(noArtist.status).toBe(409);
    expect((await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: mira, body })).status).toBe(403);
  });

  it('GET/PATCH/DELETE by id', async () => {
    const t = (await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: admin,
      body: { title: 'Scratch', isrc: 'INABC2600060', primary_artist_id: 1 } })).body.track;
    const id = String(t.track_id);
    expect((await call(track.GET, `/api/tracks/${id}`, { cookie: mira, params: { id } })).body.track.title).toBe('Scratch');
    expect((await call(track.GET, '/api/tracks/999', { cookie: mira, params: { id: '999' } })).status).toBe(404);
    const p = await call(track.PATCH, `/api/tracks/${id}`, { method: 'PATCH', cookie: admin, params: { id }, body: { title: 'Scratch 2', released_on: '2026-11-01' } });
    expect(p.body.track).toMatchObject({ title: 'Scratch 2', released_on: '2026-11-01', isrc: 'INABC2600060' });
    expect((await call(track.PATCH, `/api/tracks/${id}`, { method: 'PATCH', cookie: admin, params: { id }, body: { released_on: '1 Nov' } })).status).toBe(400);
    expect((await call(track.DELETE, `/api/tracks/${id}`, { method: 'DELETE', cookie: admin, params: { id } })).status).toBe(204);
    const used = await call(track.DELETE, '/api/tracks/1', { method: 'DELETE', cookie: admin, params: { id: '1' } });
    expect(used.status).toBe(409);
  });
});

describe('search', () => {
  it('finds tracks and artists by prefix for any role', async () => {
    const r = await call(search, '/api/search?q=owl', { cookie: mira });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: { label: string }) => x.label).sort()).toEqual(['Owl Beats Collective', 'Owl Light', 'The Night Owls']);
    expect((await call(search, '/api/search?q=', { cookie: mira })).body.results).toEqual([]);
    expect((await call(search, '/api/search?q=x')).status).toBe(401);
  });
});
