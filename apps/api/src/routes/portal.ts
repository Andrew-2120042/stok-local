import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { z } from 'zod'
import {
  createDeveloper,
  createApiKey,
  getDeveloperBySupabaseId,
  getDeveloperById,
  getDeveloperApiKeys,
  revokeApiKey,
  getDeveloperWebhooks,
  createWebhook,
  deleteWebhook,
  getDeveloperUsage,
  getDeveloperTopQueries,
} from '../lib/db'
import { generateApiKey } from '../lib/keys'

// These portal routes are called from Next.js server-side (route handlers).
// Auth is via the developer's Supabase session — we accept the supabase_user_id
// in a header (x-supabase-user-id) set by the Next.js middleware after JWT verification.

function getPortalUserId(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const v = request.headers['x-supabase-user-id']
  return typeof v === 'string' ? v : null
}

export async function portalRoutes(fastify: FastifyInstance) {
  // POST /portal/signup — called once when a developer signs up
  fastify.post('/portal/signup', async (request, reply) => {
    const schema = z.object({
      supabase_user_id: z.string(),
      email: z.string().email(),
      name: z.string().min(1),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid', details: parsed.error.flatten() })
    }

    const existing = await getDeveloperBySupabaseId(parsed.data.supabase_user_id)
    if (existing) {
      return reply.status(409).send({ error: 'Developer already exists' })
    }

    let dev: Awaited<ReturnType<typeof createDeveloper>>
    try {
      dev = await createDeveloper({
        name: parsed.data.name,
        // Normalize email so case-variants collide on the unique constraint
        // (EMAIL@TEST.COM and email@test.com are the same account).
        email: parsed.data.email.toLowerCase(),
        supabase_user_id: parsed.data.supabase_user_id,
      })
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.status(409).send({ error: 'Email already registered' })
      }
      throw err
    }

    // Auto-generate one live key + one sandbox key
    const liveKeyData = generateApiKey('live')
    const testKeyData = generateApiKey('test')

    await createApiKey({ developer_id: dev.id, key_hash: liveKeyData.hash, key_prefix: liveKeyData.prefix, is_sandbox: false, name: 'Default Live' })
    await createApiKey({ developer_id: dev.id, key_hash: testKeyData.hash, key_prefix: testKeyData.prefix, is_sandbox: true,  name: 'Default Test' })

    return reply.status(201).send({
      developer: dev,
      keys: {
        live: liveKeyData.key,
        test: testKeyData.key,
        warning: 'Store these keys now — they are only shown once',
      },
    })
  })

  // GET /portal/me — current developer profile
  fastify.get('/portal/me', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    return reply.send({ developer: dev })
  })

  // GET /portal/keys — list API keys
  fastify.get('/portal/keys', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const keys = await getDeveloperApiKeys(dev.id)
    return reply.send({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.key_prefix,
        is_sandbox: k.is_sandbox,
        last_used_at: k.last_used_at,
        created_at: k.created_at,
      })),
    })
  })

  // POST /portal/keys — create a new key
  fastify.post('/portal/keys', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const schema = z.object({
      name: z.string().min(1).max(64).default('My Key'),
      is_sandbox: z.boolean().default(false),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid', details: parsed.error.flatten() })

    const type = parsed.data.is_sandbox ? 'test' : 'live'
    const keyData = generateApiKey(type)

    await createApiKey({
      developer_id: dev.id,
      key_hash: keyData.hash,
      key_prefix: keyData.prefix,
      is_sandbox: parsed.data.is_sandbox,
      name: parsed.data.name,
    })

    return reply.status(201).send({
      key: keyData.key,
      prefix: keyData.prefix,
      warning: 'Store this key now — it is only shown once',
    })
  })

  // DELETE /portal/keys/:id — revoke a key
  fastify.delete('/portal/keys/:id', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const { id } = request.params as { id: string }
    await revokeApiKey(id, dev.id)
    return reply.send({ revoked: true })
  })

  // GET /portal/usage?days=30
  fastify.get('/portal/usage', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const days = Math.min(90, Number((request.query as any).days ?? 30))

    const [usage, topQueries] = await Promise.all([
      getDeveloperUsage(dev.id, days),
      getDeveloperTopQueries(dev.id, days),
    ])

    return reply.send({ usage, top_queries: topQueries })
  })

  // GET /portal/webhooks
  fastify.get('/portal/webhooks', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const hooks = await getDeveloperWebhooks(dev.id)
    return reply.send({ webhooks: hooks })
  })

  // POST /portal/webhooks
  fastify.post('/portal/webhooks', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const schema = z.object({
      url: z
        .string()
        .url()
        .refine((u) => /^https?:\/\//i.test(u), { message: 'Webhook URL must use http or https' })
        .refine((u) => { try { const x = new URL(u); return !x.username && !x.password } catch { return false } }, {
          message: 'Webhook URL must not contain credentials',
        }),
      events: z.array(z.string()).min(1),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid', details: parsed.error.flatten() })

    const secret = `whsec_am_${crypto.randomBytes(24).toString('hex')}`
    const hook = await createWebhook({ developer_id: dev.id, url: parsed.data.url, events: parsed.data.events, secret })

    return reply.status(201).send({ webhook: hook, secret })
  })

  // DELETE /portal/webhooks/:id
  fastify.delete('/portal/webhooks/:id', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const { id } = request.params as { id: string }
    await deleteWebhook(id, dev.id)
    return reply.send({ deleted: true })
  })

  // POST /portal/webhooks/:id/test — fire a test event
  fastify.post('/portal/webhooks/:id/test', async (request, reply) => {
    const userId = getPortalUserId(request as any)
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' })

    const dev = await getDeveloperBySupabaseId(userId)
    if (!dev) return reply.status(404).send({ error: 'Developer not found' })

    const { id } = request.params as { id: string }
    const hooks = await getDeveloperWebhooks(dev.id)
    const hook = hooks.find((h) => h.id === id)
    if (!hook) return reply.status(404).send({ error: 'Webhook not found' })

    const payload = JSON.stringify({
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook from Stok' },
    })

    const sig = crypto
      .createHmac('sha256', hook.secret)
      .update(payload)
      .digest('hex')

    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stok-Signature': `sha256=${sig}`,
          'X-Stok-Event': 'test',
        },
        body: payload,
        signal: AbortSignal.timeout(5000),
      })

      return reply.send({ status: res.status, ok: res.ok })
    } catch (err: any) {
      return reply.status(502).send({ error: 'Webhook delivery failed', detail: err.message })
    }
  })
}
