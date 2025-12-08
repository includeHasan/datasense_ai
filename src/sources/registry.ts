import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { DataSource, SchemaProfile } from "./types.js";

interface RegistryEntry {
  source: DataSource;
  profile: SchemaProfile;
  createdAt: number;
  ownerId: string;
  suggestedQuestions?: string[];
}

const registry = new Map<string, RegistryEntry>();

/**
 * Registers a connected/opened DataSource along with its cached schema
 * profile, returning a fresh sourceId that callers can use to look it up
 * later (e.g. from HTTP route handlers). The ownerId ties the source to
 * the authenticated user that created it, for ownership checks.
 */
export function registerSource(source: DataSource, profile: SchemaProfile, ownerId: string): string {
  const sourceId = randomUUID();
  registry.set(sourceId, { source, profile, createdAt: Date.now(), ownerId });
  return sourceId;
}

export function getSource(sourceId: string): DataSource | undefined {
  return registry.get(sourceId)?.source;
}

export function getProfile(sourceId: string): SchemaProfile | undefined {
  return registry.get(sourceId)?.profile;
}

/**
 * Looks up a registered source's schema profile, but only if it is owned
 * by the given ownerId. Returns undefined both when the source does not
 * exist and when it belongs to a different owner, so callers can respond
 * with a uniform 404 instead of leaking existence of other users' sources.
 */
export function getProfileForOwner(sourceId: string, ownerId: string): SchemaProfile | undefined {
  const entry = registry.get(sourceId);
  if (!entry || entry.ownerId !== ownerId) return undefined;
  return entry.profile;
}

/**
 * Looks up a registered DataSource, but only if it is owned by the given
 * ownerId. Returns undefined both when the source does not exist and when
 * it belongs to a different owner (see getProfileForOwner).
 */
export function getSourceForOwner(sourceId: string, ownerId: string): DataSource | undefined {
  const entry = registry.get(sourceId);
  if (!entry || entry.ownerId !== ownerId) return undefined;
  return entry.source;
}

/**
 * Looks up the cached suggested questions for a source, but only if it is
 * owned by the given ownerId. Returns undefined both when the source does
 * not exist/belong to a different owner, and when no questions have been
 * generated (and cached) yet, so callers should distinguish "not found" via
 * getProfileForOwner first.
 */
export function getSuggestedQuestionsForOwner(sourceId: string, ownerId: string): string[] | undefined {
  const entry = registry.get(sourceId);
  if (!entry || entry.ownerId !== ownerId) return undefined;
  return entry.suggestedQuestions;
}

/**
 * Caches generated suggested questions on a registered source, but only if
 * it is owned by the given ownerId. Returns true if the cache was written.
 */
export function cacheSuggestedQuestionsForOwner(
  sourceId: string,
  ownerId: string,
  questions: string[],
): boolean {
  const entry = registry.get(sourceId);
  if (!entry || entry.ownerId !== ownerId) return false;
  entry.suggestedQuestions = questions;
  return true;
}

/**
 * Closes and removes a registered source. Safe to call even if the source
 * has already been evicted; it simply becomes a no-op in that case.
 */
export async function removeSource(sourceId: string): Promise<void> {
  const entry = registry.get(sourceId);
  if (!entry) return;
  await entry.source.close();
  registry.delete(sourceId);
}

/**
 * Removes a registered source, but only if it is owned by the given
 * ownerId. Returns true if a source was removed, false if it did not
 * exist or belonged to a different owner (treated identically to avoid
 * leaking existence of other users' sources).
 */
export async function removeSourceForOwner(sourceId: string, ownerId: string): Promise<boolean> {
  const entry = registry.get(sourceId);
  if (!entry || entry.ownerId !== ownerId) return false;
  await entry.source.close();
  registry.delete(sourceId);
  return true;
}

/**
 * Sweeps the registry for entries older than config.sourceTtlMinutes,
 * closing and removing each one. Returns the number of entries evicted.
 */
export async function evictExpired(): Promise<number> {
  const ttlMs = config.sourceTtlMinutes * 60_000;
  const now = Date.now();
  const expiredIds: string[] = [];

  for (const [sourceId, entry] of registry) {
    if (now - entry.createdAt > ttlMs) {
      expiredIds.push(sourceId);
    }
  }

  for (const sourceId of expiredIds) {
    await removeSource(sourceId).catch(() => undefined);
  }

  return expiredIds.length;
}

const SWEEP_INTERVAL_MS = 5 * 60_000;

const sweepTimer = setInterval(() => {
  void evictExpired();
}, SWEEP_INTERVAL_MS);

sweepTimer.unref();
