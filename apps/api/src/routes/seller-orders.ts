import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  getSellerBySupabaseId,
  getSellerOrders,
  countSellerOrders,
  getSellerOrderById,
  getOrderEvents,
  getOrderById,
  getOrderDeveloperId,
  processSellerOrder,
  shipSellerOrder,
  createOrderEvent,
} from '../lib/db'
import { fireDeveloperWebhook } from '../lib/developer-webhooks'
import { sendOrderShippedEmail } from '../lib/email'
import type { Seller } from '@stok/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CARRIERS = ['Shiprocket', 'Delhivery', 'BlueDart', 'DTDC', 'India Post', 'Other'] as const

function sellerUserId(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const v = request.headers['x-supabase-user-id']
  return typeof v === 'string' && v.length > 0 ? v : null
}

export async function sellerOrderRoutes(fastify: FastifyInstance) {
  async function requireSeller(request: FastifyRequest, reply: FastifyReply): Promise<Seller | null> {
    const uid = sellerUserId(request as any)
    if (!uid) { reply.status(401).send({ error: 'Unauthorized' }); return null }
    const seller = await getSellerBySupabaseId(uid)
    if (!seller) { reply.status(404).send({ error: 'Seller not found' }); return null }
    return seller
  }

  // Resolve :id as an order OWNED by this seller — isolation choke point.
  async function requireOwnedOrder(request: FastifyRequest, reply: FastifyReply, seller: Seller) {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) { reply.status(400).send({ error: 'Invalid order ID' }); return null }
    const order = await getSellerOrderById(id, seller.id)
    if (!order) { reply.status(404).send({ error: 'Order not found' }); return null }
    return order
  }

  // GET /portal/sellers/orders — list (status filter, sort, paginate 20/page)
  fastify.get('/portal/sellers/orders', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const q = request.query as Record<string, string>
    const status = ['paid', 'processing', 'shipped', 'delivered', 'returned', 'cancelled', 'pending_payment'].includes(q.status) ? (q.status as any) : undefined
    const limit = Math.min(100, Number(q.limit) || 20)
    const offset = Math.max(0, Number(q.offset) || 0)
    const [orders, total] = await Promise.all([
      getSellerOrders(seller.id, { status, sort: q.sort === 'oldest' ? 'oldest' : 'newest', limit, offset }),
      countSellerOrders(seller.id, status),
    ])
    return reply.send({ orders, total, limit, offset })
  })

  // GET /portal/sellers/orders/:id — detail + chronological timeline (ownership)
  fastify.get('/portal/sellers/orders/:id', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const order = await requireOwnedOrder(request, reply, seller); if (!order) return
    // Privacy: the full buyer address is only revealed once the order is paid
    // (the seller needs it to fulfil). Before payment, expose city/state only.
    if (order.status === 'pending_payment' && order.shipping_address) {
      const a = order.shipping_address as Record<string, string>
      order.shipping_address = { city: a.city, state: a.state }
    }
    const events = await getOrderEvents(order.id)
    return reply.send({ order, events })
  })

  // PATCH /portal/sellers/orders/:id/process — paid → processing
  fastify.patch('/portal/sellers/orders/:id/process', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const order = await requireOwnedOrder(request, reply, seller); if (!order) return
    const won = await processSellerOrder(order.id, seller.id)
    if (!won) return reply.status(409).send({ error: 'Order is not in a processable state', status: order.status })
    await createOrderEvent({ order_id: order.id, event_type: 'order.processing', payload: { by: 'seller' } }).catch(() => {})
    return reply.send({ ok: true, status: 'processing' })
  })

  // PATCH /portal/sellers/orders/:id/ship — ship + event + developer webhook + buyer email
  fastify.patch('/portal/sellers/orders/:id/ship', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const order = await requireOwnedOrder(request, reply, seller); if (!order) return

    const schema = z.object({
      tracking_number: z.string().min(1).max(100),
      carrier: z.enum(CARRIERS),
      estimated_delivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })

    // Estimated delivery must be a future date.
    const eta = new Date(parsed.data.estimated_delivery + 'T00:00:00Z')
    const todayUTC = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
    if (!(eta.getTime() > todayUTC.getTime())) {
      return reply.status(400).send({ error: 'Estimated delivery must be a future date' })
    }

    const won = await shipSellerOrder(order.id, seller.id, parsed.data)
    if (!won) return reply.status(409).send({ error: 'Order is not in a shippable state', status: order.status })

    await createOrderEvent({
      order_id: order.id,
      event_type: 'order.shipped',
      payload: { tracking_number: parsed.data.tracking_number, carrier: parsed.data.carrier, estimated_delivery: parsed.data.estimated_delivery },
    }).catch(() => {})

    // Fire developer webhook — agents need order.shipped + tracking to notify the
    // buyer. Scoped to the order's owning developer (no cross-developer bleed).
    await fireDeveloperWebhook('order.shipped', {
      order_id: order.id,
      status: 'shipped',
      tracking_number: parsed.data.tracking_number,
      carrier: parsed.data.carrier,
      estimated_delivery: parsed.data.estimated_delivery,
    }, await getOrderDeveloperId(order.id)).catch((err: unknown) => fastify.log.error({ err }, 'order.shipped webhook failed'))

    // Buyer email with tracking (enriched order; non-blocking).
    getOrderById(order.id).then((full) => { if (full) sendOrderShippedEmail(full).catch(() => {}) }).catch(() => {})

    return reply.send({ ok: true, status: 'shipped', tracking_number: parsed.data.tracking_number, carrier: parsed.data.carrier, estimated_delivery: parsed.data.estimated_delivery })
  })
}
