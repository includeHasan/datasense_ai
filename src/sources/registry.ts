import { config } from "../config.js";
import { downloadFromGridFs, deleteFromGridFs, uploadToGridFs } from "./gridfs.js";
import { Source, type SourceDocument } from "../models/source.js";
import { DuckDBSource, type DeclaredFileType } from "./duckdb-source.js";
import { createSqlSource, type SqlSourceKind } from "./sql-source.js";
import { MongoSource } from "./mongo-source.js";
import type { DataSource, SchemaProfile } from "./types.js";

/**
 * Describes how to reconstruct a DataSource from scratch, supplied by the
 * route handler at registration time (in addition to the already-live
 * `source` it just created) so the registry can persist enough to rebuild it
 * later on any instance. See src/models/source.ts for how each variant is
 * stored.
 */
export type SourcePersistence =
  | { kind: SqlSourceKind | "mongodb"; connectionString: string }
  | { kind: "file"; buffer: Buffer; originalFilename: string; declaredType: DeclaredFileType };

interface CacheEntry {
  source: DataSource;
  profile: SchemaProfile;
  createdAt: number;
  ownerId: string;
  suggestedQuestions?: string[];
}

/**
 * Per-process cache of live DataSource instances (and their DuckDB engines /
 * DB connection pools). This is NOT the source of truth - it exists purely
 * so repeated requests hitting the same server instance don't redo expensive
 * reconnect/re-ingest work. The actual source of truth, shared across every
 * instance in a horizontally-scaled deployment, is the persisted `Source`
 * Mongo record (plus GridFS bytes for "file" kind sources) - see
 * src/models/source.ts. A cache miss here (e.g. a fresh process, or a source
 * registered by a different replica) falls through to Mongo/GridFS and
 * reconstructs the DataSource locally before caching it.
 */
const cache = new Map<string, CacheEntry>();

function toCreatedAtMs(doc: Pick<SourceDocument, "createdAt">): number {
  return (doc.createdAt ?? new Date()).getTime();
}

/**
 * Rebuilds a live DataSource from a persisted Mongo record: reconnects a
 * fresh pool for SQL kinds (cheap and stateless), or re-downloads the
 * original file bytes from GridFS and re-runs them through DuckDBSource.create
 * for "file" kind sources (not cheap - see the tradeoff note in
 * src/sources/gridfs.ts - but the only option that doesn't require keeping
 * the whole dataset resident in some single process's RAM forever).
 */
async function reconstructSource(record: SourceDocument): Promise<DataSource> {
  if (record.kind === "file") {
    if (!record.gridFsFileId) {
      throw new Error(`Source ${String(record._id)} is a "file" source with no stored gridFsFileId.`);
    }
    const buffer = await downloadFromGridFs(record.gridFsFileId);
    return DuckDBSource.create(
      buffer,
      record.originalFilename ?? "upload",
      (record.declaredType ?? "csv") as DeclaredFileType,
    );
  }

  if (!record.connectionString) {
    throw new Error(`Source ${String(record._id)} is a "${record.kind}" source with no stored connectionString.`);
  }

  if (record.kind === "mongodb") {
    return MongoSource.create(record.connectionString);
  }

  return createSqlSource(record.kind as SqlSourceKind, record.connectionString);
}

/**
 * Registers a connected/opened DataSource along with its cached schema
 * profile, persisting enough metadata (see SourcePersistence) to Mongo/GridFS
 * that any server instance can later reconstruct this source, and also
 * caching the live DataSource locally for fast repeat access from THIS
 * instance. Returns a fresh sourceId that callers can use to look it up
 * later (e.g. from HTTP route handlers). The ownerId ties the source to the
 * authenticated user that created it, for ownership checks.
 */
export async function registerSource(
  source: DataSource,
  profile: SchemaProfile,
  ownerId: string,
  persistence: SourcePersistence,
): Promise<string> {
  const gridFsFileId =
    persistence.kind === "file" ? await uploadToGridFs(persistence.buffer, persistence.originalFilename) : undefined;

  const doc = await Source.create({
    ownerId,
    kind: persistence.kind,
    profile,
    ...(persistence.kind === "file"
      ? {
          gridFsFileId,
          originalFilename: persistence.originalFilename,
          declaredType: persistence.declaredType,
        }
      : { connectionString: persistence.connectionString }),
  });

  const sourceId = String(doc._id);
  cache.set(sourceId, { source, profile, createdAt: toCreatedAtMs(doc), ownerId });
  return sourceId;
}

/**
 * Looks up a registered DataSource, but only if it is owned by the given
 * ownerId. Serves from the local per-process cache when present; on a cache
 * miss, falls back to the persisted Mongo record (still ownership-checked)
 * and reconstructs a live DataSource locally, caching it before returning.
 * Returns undefined both when the source does not exist and when it belongs
 * to a different owner (see getProfileForOwner), so callers can respond with
 * a uniform 404 instead of leaking existence of other users' sources.
 */
export async function getSourceForOwner(sourceId: string, ownerId: string): Promise<DataSource | undefined> {
  const cached = cache.get(sourceId);
  if (cached) {
    return cached.ownerId === ownerId ? cached.source : undefined;
  }

  const record = await Source.findById(sourceId).catch(() => null);
  if (!record || record.ownerId !== ownerId) return undefined;

  const source = await reconstructSource(record);
  cache.set(sourceId, {
    source,
    profile: record.profile as SchemaProfile,
    createdAt: toCreatedAtMs(record),
    ownerId,
    suggestedQuestions: record.suggestedQuestions,
  });
  return source;
}

/**
 * Looks up a registered source's schema profile, but only if it is owned by
 * the given ownerId. Served from the persisted Mongo record directly on a
 * cache miss - the profile is cached at registration time, so this never
 * needs to reconstruct a full DataSource (e.g. re-download+re-ingest a
 * GridFS file) just to answer a profile-only request. Returns undefined both
 * when the source does not exist and when it belongs to a different owner.
 */
export async function getProfileForOwner(sourceId: string, ownerId: string): Promise<SchemaProfile | undefined> {
  const cached = cache.get(sourceId);
  if (cached) {
    return cached.ownerId === ownerId ? cached.profile : undefined;
  }

  const record = await Source.findById(sourceId).catch(() => null);
  if (!record || record.ownerId !== ownerId) return undefined;
  return record.profile as SchemaProfile;
}

/**
 * Looks up the cached suggested questions for a source, but only if it is
 * owned by the given ownerId. Returns undefined both when the source does
 * not exist/belong to a different owner, and when no questions have been
 * generated (and cached) yet, so callers should distinguish "not found" via
 * getProfileForOwner first.
 */
export async function getSuggestedQuestionsForOwner(
  sourceId: string,
  ownerId: string,
): Promise<string[] | undefined> {
  const cached = cache.get(sourceId);
  if (cached) {
    return cached.ownerId === ownerId ? cached.suggestedQuestions : undefined;
  }

  const record = await Source.findById(sourceId).catch(() => null);
  if (!record || record.ownerId !== ownerId) return undefined;
  return record.suggestedQuestions;
}

/**
 * Caches generated suggested questions on a registered source, but only if
 * it is owned by the given ownerId. Persists to the Mongo record (so any
 * instance can serve them from now on) and updates the local cache entry if
 * present. Returns true if the write took effect.
 */
export async function cacheSuggestedQuestionsForOwner(
  sourceId: string,
  ownerId: string,
  questions: string[],
): Promise<boolean> {
  const cached = cache.get(sourceId);
  if (cached && cached.ownerId !== ownerId) return false;

  const record = await Source.findOneAndUpdate(
    { _id: sourceId, ownerId },
    { $set: { suggestedQuestions: questions } },
  ).catch(() => null);

  if (!record && !cached) return false;

  if (cached) {
    cached.suggestedQuestions = questions;
  }

  return true;
}

/**
 * Closes and removes a registered source's local cache entry. Safe to call
 * even if the source has already been evicted; it simply becomes a no-op in
 * that case. Does NOT touch the persisted Mongo/GridFS record - kept for
 * backwards-compatible internal use (e.g. by evictExpired/removeSourceForOwner
 * once they've already decided a source should go away everywhere).
 */
async function removeFromCache(sourceId: string): Promise<void> {
  const entry = cache.get(sourceId);
  if (!entry) return;
  await entry.source.close().catch(() => undefined);
  cache.delete(sourceId);
}

/**
 * Removes a registered source, but only if it is owned by the given
 * ownerId. Deletes both the local cache entry (closing the live DataSource
 * if present on this instance) and the persisted Mongo record (and its
 * GridFS file, if a "file" kind source), so the source is gone everywhere,
 * not just from this process. Returns true if a source was removed, false if
 * it did not exist or belonged to a different owner (treated identically to
 * avoid leaking existence of other users' sources).
 */
export async function removeSourceForOwner(sourceId: string, ownerId: string): Promise<boolean> {
  const cached = cache.get(sourceId);
  if (cached && cached.ownerId !== ownerId) return false;

  const record = await Source.findOneAndDelete({ _id: sourceId, ownerId }).catch(() => null);

  if (cached) {
    await removeFromCache(sourceId);
  }

  if (!record) {
    // Either there was no persisted record at all (only ever true for a
    // cache-only entry, which registerSource no longer produces, but kept
    // defensive), or it belonged to someone else - already excluded above.
    return Boolean(cached);
  }

  if (record.kind === "file" && record.gridFsFileId) {
    await deleteFromGridFs(record.gridFsFileId).catch(() => undefined);
  }

  return true;
}

/**
 * Sweeps for sources - both the persisted Mongo/GridFS records and any local
 * cache entries - older than config.sourceTtlMinutes, closing/deleting each
 * one. Returns the number of sources evicted. Sweeping the persisted records
 * (not just the local cache) ensures an old source doesn't live forever in
 * Mongo/GridFS after its TTL just because no instance happens to have it
 * cached locally.
 */
export async function evictExpired(): Promise<number> {
  const ttlMs = config.sourceTtlMinutes * 60_000;
  const cutoff = new Date(Date.now() - ttlMs);

  const expiredRecords = await Source.find({ createdAt: { $lt: cutoff } }).catch(() => []);
  let evicted = 0;

  for (const record of expiredRecords) {
    const sourceId = String(record._id);
    await removeFromCache(sourceId);
    if (record.kind === "file" && record.gridFsFileId) {
      await deleteFromGridFs(record.gridFsFileId).catch(() => undefined);
    }
    await Source.deleteOne({ _id: record._id }).catch(() => undefined);
    evicted += 1;
  }

  // Defensive: also sweep any local cache entries that are stale but whose
  // Mongo record was somehow missed above (e.g. deleted out-of-band).
  const expiredCacheIds: string[] = [];
  for (const [sourceId, entry] of cache) {
    if (Date.now() - entry.createdAt > ttlMs) {
      expiredCacheIds.push(sourceId);
    }
  }
  for (const sourceId of expiredCacheIds) {
    await removeFromCache(sourceId);
    evicted += 1;
  }

  return evicted;
}

/**
 * Test-only escape hatch that wipes the local per-process cache WITHOUT
 * touching the persisted Mongo/GridFS records, simulating "a different
 * server instance" (or a fresh restart of this one) within a single test
 * process. Deliberately does not close cached DataSources first - a real
 * process crash/restart wouldn't get the chance to either - so tests using
 * this should not assume a clean close happened for whatever was cached.
 */
export function clearLocalCacheForTests(): void {
  cache.clear();
}

const SWEEP_INTERVAL_MS = 5 * 60_000;

const sweepTimer = setInterval(() => {
  void evictExpired().catch(() => undefined);
}, SWEEP_INTERVAL_MS);

sweepTimer.unref();
