import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createSeller,
  getSellerBySupabaseId,
  updateSeller,
  getSellerStats,
  getSellerEarnings,
  getSellerEarningsTotals,
} from '../lib/db'

// Seller portal routes — authenticated via the Supabase session, surfaced to
// the API as the `x-supabase-user-id` header set server-side by Next.js after
// it verifies the JWT (same pattern as the developer portal). These are
// /portal/* routes, so they are exempt from the API-key preHandler.
//
// NOTE: Stripe Connect onboarding/payout routes were removed in Phase 5 (deferred).
// Seller payouts are tracked in the seller_earnings ledger instead. See STRIPE_TODO.md.

function sellerUserId(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const v = request.headers['x-supabase-user-id']
  return typeof v === 'string' && v.length > 0 ? v : null
}

export async function sellerPortalRoutes(fastify: FastifyInstance) {
  // POST /portal/sellers/signup — create the seller record after Supabase signup
  fastify.post('/portal/sellers/signup', async (request, reply) => {
    const schema = z.object({
      supabase_user_id: z.string().min(1),
      name: z.string().min(1).max(200),
      email: z.string().email(),
      phone: z.string().optional(),
      business_type: z.enum(['individual', 'company']).default('individual'),
      gst_number: z.string().optional(),
      description: z.string().max(2000).optional(),
      address: z.record(z.any()).optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid', details: parsed.error.flatten() })

    const existing = await getSellerBySupabaseId(parsed.data.supabase_user_id)
    if (existing) return reply.status(409).send({ error: 'Seller already exists', seller: existing })

    try {
      const seller = await createSeller(parsed.data)
      return reply.status(201).send({ seller })
    } catch (err: any) {
      if (err.code === '23505') return reply.status(409).send({ error: 'Email already registered' })
      throw err
    }
  })

  // GET /portal/sellers/me — current seller profile
  fastify.get('/portal/sellers/me', async (request, reply) => {
    const uid = sellerUserId(request as any)
    if (!uid) return reply.status(401).send({ error: 'Unauthorized' })
    const seller = await getSellerBySupabaseId(uid)
    if (!seller) return reply.status(404).send({ error: 'Seller not found' })
    return reply.send({ seller })
  })

  // PATCH /portal/sellers/me — update profile
  fastify.patch('/portal/sellers/me', async (request, reply) => {
    const uid = sellerUserId(request as any)
    if (!uid) return reply.status(401).send({ error: 'Unauthorized' })
    const seller = await getSellerBySupabaseId(uid)
    if (!seller) return reply.status(404).send({ error: 'Seller not found' })

    const schema = z.object({
      name: z.string().min(1).max(200).optional(),
      phone: z.string().optional(),
      business_type: z.enum(['individual', 'company']).optional(),
      gst_number: z.string().optional(),
      description: z.string().max(2000).optional(),
      address: z.record(z.any()).optional(),
      logo_url: z.string().url().optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid', details: parsed.error.flatten() })

    await updateSeller(seller.id, parsed.data)
    const updated = await getSellerBySupabaseId(uid)
    return reply.send({ seller: updated })
  })

  // GET /portal/sellers/me/stats — dashboard stats
  fastify.get('/portal/sellers/me/stats', async (request, reply) => {
    const uid = sellerUserId(request as any)
    if (!uid) return reply.status(401).send({ error: 'Unauthorized' })
    const seller = await getSellerBySupabaseId(uid)
    if (!seller) return reply.status(404).send({ error: 'Seller not found' })
    const stats = await getSellerStats(seller.id)
    return reply.send({ stats })
  })

  // GET /portal/sellers/me/earnings — earnings ledger (substitute for Connect payouts)
  // GET /portal/sellers/payouts — paginated alias (limit/offset/has_more)
  async function earningsHandler(request: any, reply: any) {
    const uid = sellerUserId(request)
    if (!uid) return reply.status(401).send({ error: 'Unauthorized' })
    const seller = await getSellerBySupabaseId(uid)
    if (!seller) return reply.status(404).send({ error: 'Seller not found' })
    const q = request.query as Record<string, string>
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100))
    const offset = Math.max(0, Number(q.offset) || 0)
    const { earnings, has_more, total } = await getSellerEarnings(seller.id, limit, offset)
    const totals = await getSellerEarningsTotals(seller.id)
    return reply.send({ earnings, totals, has_more, total, limit, offset })
  }
  fastify.get('/portal/sellers/me/earnings', earningsHandler)
  fastify.get('/portal/sellers/payouts', earningsHandler)
}
