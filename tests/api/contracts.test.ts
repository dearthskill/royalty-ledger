import { describe, it, expect, beforeAll } from 'vitest';
import * as trackContracts from '@/app/api/tracks/[id]/contracts/route';
import * as contract from '@/app/api/contracts/[id]/route';
import { PUT as putSplits } from '@/app/api/contracts/[id]/splits/route';
import { POST as activate } from '@/app/api/contracts/[id]/activate/route';
import { GET as effective } from '@/app/api/tracks/[id]/effective-split/route';
import { GET as history } from '@/app/api/tracks/[id]/history/route';
import { ADMIN, AUDITOR, MIRA, call, cookieFor } from '../helpers';

// Seed: track 1 = contract 1 (v1, superseded) + contract 9 (v2, active: Night Owls 70 / Mira 30);
// track 5 = contract 5 (Mira 70 / Nova 30); track 8 = contract 8 (draft, 90%).
let admin: string, auditor: string, mira: string;
beforeAll(async () => {
  [admin, auditor, mira] = await Promise.all([cookieFor(ADMIN), cookieFor(AUDITOR), cookieFor(MIRA)]);
});
const p = (id: number | string) => ({ id: String(id) });

describe('GET /api/tracks/:id/contracts', () => {
  it('lists versions newest first with their splits (admin, auditor)', async () => {
    const r = await call(trackContracts.GET, '/api/tracks/1/contracts', { cookie: auditor, params: p(1) });
    expect(r.status).toBe(200);
    expect(r.body.contracts.map((c: { version: number; status: string }) => [c.version, c.status]))
      .toEqual([[2, 'active'], [1, 'superseded']]);
    expect(r.body.contracts[0]).toMatchObject({ total_share_pct: '100.00', splits: [
      { artist_id: 5, name: 'The Night Owls', kind: 'group', share_pct: '70.00' },
      { artist_id: 3, name: 'Mira', kind: 'solo', share_pct: '30.00' }] });
  });
  it('403 for artists, 404 for unknown tracks', async () => {
    expect((await call(trackContracts.GET, '/api/tracks/1/contracts', { cookie: mira, params: p(1) })).status).toBe(403);
    expect((await call(trackContracts.GET, '/api/tracks/999/contracts', { cookie: admin, params: p(999) })).status).toBe(404);
  });
});

describe('draft -> splits -> activate', () => {
  let draftId: number;

  it('POST creates the next version as a draft, copying the active splits', async () => {
    const r = await call(trackContracts.POST, '/api/tracks/5/contracts', { method: 'POST', cookie: admin, params: p(5) });
    expect(r.status).toBe(201);
    expect(r.body.contract).toMatchObject({ track_id: 5, version: 2, status: 'draft', total_share_pct: '100.00' });
    expect(r.body.contract.splits.map((s: { artist_id: number }) => s.artist_id)).toEqual([3, 1]);
    draftId = r.body.contract.contract_id;
  });

  it('POST refuses a second draft (409) and unknown tracks (404); auditors cannot create', async () => {
    const again = await call(trackContracts.POST, '/api/tracks/5/contracts', { method: 'POST', cookie: admin, params: p(5) });
    expect(again).toMatchObject({ status: 409, body: { error: 'Track 5 already has a draft contract (version 2)' } });
    expect((await call(trackContracts.POST, '/api/tracks/999/contracts', { method: 'POST', cookie: admin, params: p(999) })).status).toBe(404);
    expect((await call(trackContracts.POST, '/api/tracks/5/contracts', { method: 'POST', cookie: auditor, params: p(5) })).status).toBe(403);
  });

  it('PUT splits replaces a draft\'s splits; any total is allowed on a draft', async () => {
    const put = (body: unknown) => call(putSplits, `/api/contracts/${draftId}/splits`, { method: 'PUT', cookie: admin, params: p(draftId), body });
    const r = await put({ splits: [{ artist_id: 3, share_pct: 50 }, { artist_id: 1, share_pct: 40 }] });
    expect(r.status).toBe(200);
    expect(r.body.contract.total_share_pct).toBe('90.00');
    expect((await put({ splits: [{ artist_id: 3, share_pct: 50 }, { artist_id: 3, share_pct: 50 }] })).status).toBe(400);
    const ghost = await put({ splits: [{ artist_id: 999, share_pct: 100 }] });
    expect(ghost.status).toBe(409);
    expect(ghost.body.error).toMatch(/foreign key/);
  });

  it('PUT splits on an active or superseded contract is 409 with the rule text', async () => {
    const r = await call(putSplits, '/api/contracts/9/splits', { method: 'PUT', cookie: admin, params: p(9), body: { splits: [] } });
    expect(r).toMatchObject({ status: 409, body: { error: 'Contract 9 is active; splits can only be edited on a draft' } });
    expect((await call(putSplits, '/api/contracts/999/splits', { method: 'PUT', cookie: admin, params: p(999), body: { splits: [] } })).status).toBe(404);
  });

  it('activate refuses anything but exactly 100%, with the database message', async () => {
    const r = await call(activate, `/api/contracts/${draftId}/activate`, { method: 'POST', cookie: admin, params: p(draftId) });
    expect(r).toMatchObject({ status: 409, body: { error: `Splits of contract ${draftId} total 90 percent, must be exactly 100` } });
    const seeded = await call(activate, '/api/contracts/8/activate', { method: 'POST', cookie: admin, params: p(8) });
    expect(seeded.status).toBe(409);
  });

  it('activate at 100% supersedes the old version in one step', async () => {
    await call(putSplits, `/api/contracts/${draftId}/splits`, { method: 'PUT', cookie: admin, params: p(draftId),
      body: { splits: [{ artist_id: 3, share_pct: 50 }, { artist_id: 1, share_pct: 50 }] } });
    const r = await call(activate, `/api/contracts/${draftId}/activate`, { method: 'POST', cookie: admin, params: p(draftId) });
    expect(r.status).toBe(200);
    expect(r.body.contract).toMatchObject({ status: 'active', version: 2 });
    expect(r.body.contract.activated_at).toBeTruthy();
    const old = await call(contract.GET, '/api/contracts/5', { cookie: auditor, params: p(5) });
    expect(old.body.contract.status).toBe('superseded');
    const again = await call(activate, `/api/contracts/${draftId}/activate`, { method: 'POST', cookie: admin, params: p(draftId) });
    expect(again.body.error).toBe(`Contract ${draftId} is active; only a draft can be activated`);
  });
});

describe('DELETE /api/contracts/:id', () => {
  it('deletes drafts only', async () => {
    const d = (await call(trackContracts.POST, '/api/tracks/6/contracts', { method: 'POST', cookie: admin, params: p(6) })).body.contract;
    expect((await call(contract.DELETE, `/api/contracts/${d.contract_id}`, { method: 'DELETE', cookie: admin, params: p(d.contract_id) })).status).toBe(204);
    const active = await call(contract.DELETE, '/api/contracts/9', { method: 'DELETE', cookie: admin, params: p(9) });
    expect(active).toMatchObject({ status: 409, body: { error: 'Only draft contracts can be deleted (contract 9 is active)' } });
    expect((await call(contract.DELETE, '/api/contracts/999', { method: 'DELETE', cookie: admin, params: p(999) })).status).toBe(404);
    expect((await call(contract.DELETE, '/api/contracts/8', { method: 'DELETE', cookie: auditor, params: p(8) })).status).toBe(403);
  });
});

describe('GET /api/tracks/:id/effective-split', () => {
  it('resolves nested groups to solo artists with share paths', async () => {
    const r = await call(effective, '/api/tracks/1/effective-split', { cookie: auditor, params: p(1) });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ track_id: 1, contract_id: 9, version: 2 });
    expect(r.body.split).toEqual([
      { artist_id: 1, name: 'Nova', effective_pct: '35.0000', share_path: 'The Night Owls 70% > Nova 50%' },
      { artist_id: 3, name: 'Mira', effective_pct: '30.0000', share_path: 'Mira 30%' },
      { artist_id: 2, name: 'Kai', effective_pct: '21.0000', share_path: 'The Night Owls 70% > Owl Beats Collective 50% > Kai 60%' },
      { artist_id: 4, name: 'Lina', effective_pct: '14.0000', share_path: 'The Night Owls 70% > Owl Beats Collective 50% > Lina 40%' },
    ]);
  });
  it('409 without an active contract, 404 unknown, 403 for artists', async () => {
    expect(await call(effective, '/api/tracks/8/effective-split', { cookie: admin, params: p(8) }))
      .toMatchObject({ status: 409, body: { error: 'Track 8 has no active contract' } });
    expect((await call(effective, '/api/tracks/999/effective-split', { cookie: admin, params: p(999) })).status).toBe(404);
    expect((await call(effective, '/api/tracks/1/effective-split', { cookie: mira, params: p(1) })).status).toBe(403);
  });
});

describe('GET /api/tracks/:id/history', () => {
  it('returns contract and split changes of the track, newest first', async () => {
    const r = await call(history, '/api/tracks/5/history', { cookie: auditor, params: p(5) });
    expect(r.status).toBe(200);
    const ops = r.body.entries.map((e: { table_name: string; op: string }) => `${e.table_name}:${e.op}`);
    expect(ops[0]).toBe('contract:UPDATE');                   // the activation
    expect(ops).toContain('contract_split:DELETE');           // PUT splits replaced the set
    const activation = r.body.entries[0];
    expect(activation.after.status).toBe('active');
    expect(activation.actor).toBe('admin@royalty.test');
    const ids = r.body.entries.map((e: { audit_id: number }) => e.audit_id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
  });
  it('404 unknown track, 403 for artists', async () => {
    expect((await call(history, '/api/tracks/999/history', { cookie: admin, params: p(999) })).status).toBe(404);
    expect((await call(history, '/api/tracks/5/history', { cookie: mira, params: p(5) })).status).toBe(403);
  });
});
