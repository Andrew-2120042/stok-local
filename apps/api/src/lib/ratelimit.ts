import type { DeveloperPlan } from '@stok/types'

export const PLAN_LIMITS: Record<DeveloperPlan, { searches_per_day: number; orders_per_day: number }> = {
  free:       { searches_per_day: 100,   orders_per_day: 10   },
  starter:    { searches_per_day: 1000,  orders_per_day: 100  },
  pro:        { searches_per_day: 10000, orders_per_day: 1000 },
  enterprise: { searches_per_day: -1,    orders_per_day: -1   },
}

interface WindowEntry {
  count: number
  resetAt: number
}

const windows = new Map<string, WindowEntry>()

export function checkRateLimit(params: {
  key: string
  limit: number
  windowMs: number
}): { allowed: boolean; remaining: number; resetAt: number } {
  if (params.limit === -1) {
    return { allowed: true, remaining: -1, resetAt: 0 }
  }

  const now = Date.now()
  const entry = windows.get(params.key)

  if (!entry || entry.resetAt < now) {
    windows.set(params.key, { count: 1, resetAt: now + params.windowMs })
    return { allowed: true, remaining: params.limit - 1, resetAt: now + params.windowMs }
  }

  if (entry.count >= params.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: params.limit - entry.count, resetAt: entry.resetAt }
}

// Expose current count for usage reporting (portal dashboard)
export function getRateLimitCount(key: string): number {
  const entry = windows.get(key)
  if (!entry || entry.resetAt < Date.now()) return 0
  return entry.count
}

// For testing — number of active rate limit windows in memory
export function getRateLimitWindowSize(): number {
  return windows.size
}

// Prune expired windows to prevent unbounded memory growth
export function pruneExpiredWindows(): void {
  const now = Date.now()
  for (const [key, entry] of windows) {
    if (entry.resetAt < now) windows.delete(key)
  }
}
