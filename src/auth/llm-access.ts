import config from "../config.js";
import { decryptSecret } from "./crypto.js";
import type { LlmOverrides } from "../agent/llm.js";
import type { UserDocument } from "../models/user.js";

/**
 * Central helper for the freemium quota + bring-your-own-credentials feature,
 * shared by the /ask and /reports routes.
 *
 * Two orthogonal concepts:
 * - Credential resolution ({@link resolveLlm}): which LLM does this user's
 *   query run against - the app's key (free tier) or the user's own.
 * - Free-tier quota ({@link checkQuota} / {@link consumeQuota}): how many of
 *   the app-key-backed free queries this user has left this calendar month.
 *   Users on their own key are unlimited and never consume the allowance.
 */

/**
 * The subset of the User mongoose document these helpers touch. Accepting this
 * narrow shape (rather than the full HydratedDocument) keeps the helpers easy
 * to unit-test with a plain object while still working with a real doc, whose
 * `.save()` persists any mutations made here.
 */
export interface QuotaUser {
  llmApiKeyEnc?: string | null;
  llmBaseUrl?: string | null;
  llmModel?: string | null;
  quotaMonth?: string | null;
  quotaCount?: number | null;
  save?: () => Promise<unknown>;
}

export interface ResolvedLlm {
  overrides: LlmOverrides;
  usesOwnKey: boolean;
}

export interface QuotaStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Whether the user has stored their own key. Cheap presence check (no
 * decryption) - used by the quota helpers so a malformed stored blob never
 * blocks quota accounting.
 */
export function hasOwnKey(user: QuotaUser): boolean {
  return Boolean(user.llmApiKeyEnc);
}

/** Current calendar month as "YYYY-MM" in UTC. */
export function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Resolves which LLM credentials a user's query should run against. If the
 * user has stored their own key, it is decrypted and returned as overrides
 * (with their base URL + model); otherwise empty overrides mean getChatModel
 * falls back to the app's OPENAI_API_KEY / model.
 */
export function resolveLlm(user: QuotaUser): ResolvedLlm {
  if (user.llmApiKeyEnc) {
    return {
      overrides: {
        apiKey: decryptSecret(user.llmApiKeyEnc),
        baseUrl: user.llmBaseUrl ?? undefined,
        model: user.llmModel ?? undefined,
      },
      usesOwnKey: true,
    };
  }
  return { overrides: {}, usesOwnKey: false };
}

/**
 * Number of free queries the user has consumed in the *current* month. A
 * stored quotaMonth that isn't the current month means the allowance has
 * reset, so used is 0.
 */
export function usedThisMonth(user: QuotaUser): number {
  if (user.quotaMonth !== currentMonth()) return 0;
  return user.quotaCount ?? 0;
}

/**
 * Checks whether a user may run another query. Users on their own key are
 * always allowed (their cost/quota, not ours). Free-tier users are allowed
 * while their current-month usage is below the configured limit.
 */
export function checkQuota(user: QuotaUser): QuotaStatus {
  const limit = config.freeQueriesPerMonth;
  if (hasOwnKey(user)) {
    return { allowed: true, remaining: limit, limit };
  }
  const used = usedThisMonth(user);
  return {
    allowed: used < limit,
    remaining: Math.max(0, limit - used),
    limit,
  };
}

/**
 * Records one successful free-tier query against the user's monthly
 * allowance. No-op for users on their own key (unlimited, uncounted). Resets
 * the counter first when crossing into a new calendar month. Persists via the
 * document's `.save()`.
 */
export async function consumeQuota(user: QuotaUser): Promise<void> {
  if (hasOwnKey(user)) return;

  if (user.quotaMonth !== currentMonth()) {
    user.quotaMonth = currentMonth();
    user.quotaCount = 0;
  }
  user.quotaCount = (user.quotaCount ?? 0) + 1;
  await user.save?.();
}

/** Re-export so routes/tests can import the doc type from one place. */
export type { UserDocument };
