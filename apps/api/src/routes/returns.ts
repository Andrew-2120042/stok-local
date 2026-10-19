import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  getOrderById,
  getOrderDeveloperId,
  getReturnByOrderId,
  getReturnById,
  createReturn,
  createOrderEvent,
  getReturnPolicy,
} from '../lib/db'
import { sendReturnRequestedSellerEmail } from '../lib/email'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_RETURN_WINDOW_DAYS = 30

// Agent-facing return endpoints — API-key auth via the global preHandler, so
// request.auth.developerId is set. Returns are scoped to the developer that
// created the order (an agent can only return its own orders).
export async function returnRoutes(fastify: FastifyInstance) {
  fastify.post('/v1/return', async (request, reply) => {
    const auth = request.auth!
    const schema = z.object({
      order_id: z.string().uuid(),
      reason: z.enum(['wrong_product', 'damaged', 'not_as_described', 'changed_mind', 'defective', 'other']),
      description: z.string().max(2000).optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })

    const order = await getOrderById(parsed.data.order_id)
    if (!order) return reply.status(404).send({ error: 'Order not found' })

    // Scope to the developer that placed the order.
    const ownerDev = await getOrderDeveloperId(order.id)
    if (ownerDev !== auth.developerId) return reply.status(404).send({ error: 'Order not found' })

    if (!['delivered', 'shipped'].includes(order.status)) {
      return reply.status(400).send({ error: 'Order is not eligible for return', code: 'NOT_RETURNABLE', status: order.status })
    }

    // Honor the seller's return policy (accepts_returns + window_days).
    const policy = await getReturnPolicy(order.seller_id)
    if (policy && policy.accepts_returns === false) {
      return reply.status(400).send({ error: 'Seller does not accept returns', code: 'RETURNS_DISABLED' })
    }
    const windowDays = policy && typeof policy.window_days === 'number' ? policy.window_days : DEFAULT_RETURN_WINDOW_DAYS
    const ageDays = (Date.now() - new Date(order.created_at).getTime()) / 86400000
    if (ageDays > windowDays) {
      return reply.status(400).send({ error: `Return window of ${windowDays} days has passed`, code: 'RETURN_WINDOW_EXPIRED' })
    }
    const existing = await getReturnByOrderId(order.id)
    if (existing) return reply.status(409).send({ error: 'A return already exists for this order', return_id: existing.id, status: existing.status })

    let ret
    try {
      ret = await createReturn({
        order_id: order.id,
        seller_id: order.seller_id,
        reason: parsed.data.reason,
        description: parsed.data.description ?? null,
        pickup_address: order.shipping_address, // snapshot the buyer address
      })
    } catch (err: any) {
      // Concurrent request won the race (UNIQUE on order_id) → treat as duplicate.
      if (err.code === '23505') return reply.status(409).send({ error: 'A return already exists for this order' })
      throw err
    }

    await createOrderEvent({ order_id: order.id, event_type: 'return.requested', payload: { return_id: ret.id, reason: parsed.data.reason } }).catch(() => {})
    sendReturnRequestedSellerEmail(order.seller_email, { order_id: order.id, product_name: order.product_name, reason: parsed.data.reason, description: parsed.data.description }).catch(() => {})

    return reply.status(201).send({ return_id: ret.id, status: ret.status, message: 'Return requested. The seller will review and arrange pickup.' })
  })

  fastify.get('/v1/return/:id', async (request, reply) => {
    const auth = request.auth!
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.status(400).send({ error: 'Invalid return ID' })

    const ret = await getReturnById(id)
    if (!ret) return reply.status(404).send({ error: 'Return not found' })
    const ownerDev = await getOrderDeveloperId(ret.order_id)
    if (ownerDev !== auth.developerId) return reply.status(404).send({ error: 'Return not found' })

    const scheduledOrLater = ['pickup_scheduled', 'picked_up', 'received', 'refunded'].includes(ret.status)
    return reply.send({
      return_id: ret.id,
      order_id: ret.order_id,
      status: ret.status,
      reason: ret.reason,
      description: ret.description ?? null,
      ...(scheduledOrLater ? {
        pickup: { carrier: ret.pickup_carrier, tracking_number: ret.pickup_tracking_number, pickup_date: ret.pickup_date },
        pickup_carrier: ret.pickup_carrier, pickup_tracking_number: ret.pickup_tracking_number, pickup_date: ret.pickup_date,
      } : {}),
      ...(ret.status === 'rejected' ? { seller_notes: ret.seller_notes } : {}),
      ...(ret.refund_amount != null ? { refund_amount: Number(ret.refund_amount) } : {}),
      created_at: ret.created_at,
      updated_at: ret.updated_at,
    })
  })
}
