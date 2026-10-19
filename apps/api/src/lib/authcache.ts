// Short-TTL in-memory cache for API-key auth lookups.
//
// API key auth otherwise costs a DB round-trip on every single request. At any
// real request volume that round-trip dominates per-call latency, so we cache
// the resolved auth context (and negative lookups) keyed by the key hash.
//
// Correctness: keys are hard-deleted on revoke, so we clear the entire cache on
// any revocation. The TTL is short enough that plan changes propagate quickly.

import type { AuthContext } from '../middleware/auth'

interface CacheEntry {
  // null = a negative result (key not found) — cached so repeated bad/fake keys
  // don't hammer the DB.
  value: AuthContext | null
  expiresAt: number
}

const TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

export function getCachedAuth(keyHash: string): { hit: boolean; value: AuthContext | null } {
  const entry = cache.get(keyHash)
  if (!entry) return { hit: false, value: null }
  if (entry.expiresAt < Date.now()) {
    cache.delete(keyHash)
    return { hit: false, value: null }
  }
  return { hit: true, value: entry.value }
}

export function setCachedAuth(keyHash: string, value: AuthContext | null): void {
  cache.set(keyHash, { value, expiresAt: Date.now() + TTL_MS })
}

// Invalidate everything — called whenever a key is revoked so a deleted key can
// never be served from cache.
export function clearAuthCache(): void {
  cache.clear()
}

export function getAuthCacheSize(): number {
  return cache.size
}
