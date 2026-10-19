import { FastifyRequest, FastifyReply } from 'fastify'
import { hashKey } from '../lib/keys'
import { getApiKeyByHash, updateApiKeyLastUsed } from '../lib/db'
import { getCachedAuth, setCachedAuth } from '../lib/authcache'
import type { DeveloperPlan } from '@stok/types'

export interface AuthContext {
  developerId: string
  apiKeyId: string
  isSandbox: boolean
  plan: DeveloperPlan
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

// Resolve the developer from the Authorization header WITHOUT failing the
// request when it is absent/invalid. Used by capability-URL endpoints (e.g. the
// checkout-page order read) that are public, but must still scope to the owning
// developer when a valid key IS supplied.
export async function resolveAuth(request: FastifyRequest): Promise<AuthContext | null> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const rawKey = authHeader.slice(7)
  if (!rawKey.startsWith('sk_live_am_') && !rawKey.startsWith('sk_test_am_')) return null
  const keyHash = hashKey(rawKey)
  const cached = getCachedAuth(keyHash)
  if (cached.hit) return cached.value
  const apiKey = await getApiKeyByHash(keyHash)
  if (!apiKey) { setCachedAuth(keyHash, null); return null }
  const ctx: AuthContext = { developerId: apiKey.developer_id, apiKeyId: apiKey.id, isSandbox: apiKey.is_sandbox, plan: apiKey.plan as DeveloperPlan }
  setCachedAuth(keyHash, ctx)
  return ctx
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({
      error: 'Missing API key',
      message: 'Include your API key as: Authorization: Bearer sk_live_am_...',
      docs: 'https://docs.stok.dev/authentication',
    })
    return
  }

  const rawKey = authHeader.slice(7)

  if (!rawKey.startsWith('sk_live_am_') && !rawKey.startsWith('sk_test_am_')) {
    reply.status(401).send({
      error: 'Invalid API key format',
      message: 'API keys must start with sk_live_am_ or sk_test_am_',
    })
    return
  }

  const keyHash = hashKey(rawKey)

  // Serve from the short-TTL cache when possible to avoid a DB round-trip per
  // request. Negative lookups are cached too, so repeated bad keys stay cheap.
  const cached = getCachedAuth(keyHash)
  if (cached.hit) {
    if (!cached.value) {
      reply.status(401).send({
        error: 'Invalid API key',
        message: 'This API key does not exist or has been revoked',
      })
      return
    }
    request.auth = cached.value
    return
  }

  const apiKey = await getApiKeyByHash(keyHash)

  if (!apiKey) {
    setCachedAuth(keyHash, null)
    reply.status(401).send({
      error: 'Invalid API key',
      message: 'This API key does not exist or has been revoked',
    })
    return
  }

  // Only touch last_used_at on a cache miss (i.e. roughly once per TTL window)
  // rather than on every request — keeps the hot path write-free.
  updateApiKeyLastUsed(apiKey.id).catch(console.error)

  const authContext: AuthContext = {
    developerId: apiKey.developer_id,
    apiKeyId: apiKey.id,
    isSandbox: apiKey.is_sandbox,
    plan: apiKey.plan as DeveloperPlan,
  }
  setCachedAuth(keyHash, authContext)
  request.auth = authContext
}
