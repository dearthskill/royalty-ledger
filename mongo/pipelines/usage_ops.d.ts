// Types for usage_ops.js (used by the TypeScript routes; the JS file stays plain CommonJS).
import type { Db, ObjectId } from 'mongodb';

type Id = ObjectId | string;
type Scope = { batchId?: Id; periodId?: number; userId?: number };
type Counts = { events: number; plays: number };

export const DEFAULT_BOT_PLAYS_PER_HOUR: number;
export function ingest(db: Db,
  meta: { period_id: number; platform: string; source_file: string; uploaded_by: number },
  rows: { track_id: number; plays: number; listener_hash: string; played_at: Date; device?: string; raw?: object }[]
): Promise<{ batch_id: ObjectId; row_count: number }>;
export function findDuplicates(db: Db, scope: Scope): Promise<{
  track_id: number; platform: string; listener_hash: string; played_at: Date; count: number; keep: ObjectId; duplicates: ObjectId[];
}[]>;
export function findFlagged(db: Db, scope: Scope & { maxPlaysPerHour?: number }): Promise<{
  platform: string; listener_hash: string; hour: Date; plays: number; event_count: number; ids: ObjectId[];
}[]>;
export function aggregateUsage(db: Db, periodId: number): Promise<{ track_id: number; platform: string; plays: number }[]>;
export function listBatches(db: Db, periodId?: number): Promise<Record<string, unknown>[]>;
export function batchStats(db: Db, periodId: number): Promise<{ batch_id: ObjectId; by_status: Record<string, Counts> }[]>;
export function voidDuplicates(db: Db, scope: Scope): Promise<{ voided: number }>;
export function voidFlagged(db: Db, scope: Scope & { maxPlaysPerHour?: number }): Promise<{ voided: number; listeners: number }>;
export function disputeBatch(db: Db, batchId: Id, userId: number, text: string): Promise<{ updated: number }>;
export function resolveDispute(db: Db, batchId: Id, userId: number, text: string): Promise<{ updated: number }>;
export function markAggregated(db: Db, periodId: number, userId: number): Promise<{ updated: number }>;
export function purgeVoided(db: Db, scope: Scope): Promise<{ deleted: number }>;
