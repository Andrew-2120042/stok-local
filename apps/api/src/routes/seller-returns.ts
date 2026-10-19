import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  getSellerBySupabaseId,
  getSellerReturns,
  getSellerReturnById,
  getOrderById,
  getOrderEvents,
  transitionReturn,
  createOrderEvent,
  getEarningAmountForOrder,
  cancelEarningForOrder,
  markOrderReturned,
  countRecentReceivedReturns,
  countSellerTotalOrders,
  suspendSeller,
  getReturnPolicy,
  updateReturnPolicy,
  getOrderDeveloperId,
} from '../lib/db'
import { fireDeveloperWebhook } from '../lib/developer-webhooks'
import { recalculateProductQualityScore } from '../lib/quality'
import {
  sendReturnApprovedEmail, sendReturnRejectedEmail, sendReturnPickupScheduledEmail,
  sendReturnPickedUpEmail, sendReturnReceivedEmail, sendSellerSuspendedEmail,
} from '../lib/email'
import type { Seller } from '@stok/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CARRIERS = ['Shiprocket', 'Delhivery', 'BlueDart', 'DTDC', 'India Post', 'Other'] as const

function sellerUserId(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const v = request.headers['x-supabase-user-id']
  return typeof v === 'string' && v.length > 0 ? v : null
}

export async function sellerReturnRoutes(fastify: FastifyInstance) {
  async function requireSeller(request: FastifyRequest, reply: FastifyReply): Promise<Seller | null> {
    const uid = sellerUserId(request as any)
    if (!uid) { reply.status(401).send({ error: 'Unauthorized' }); return null }
    const seller = await getSellerBySupabaseId(uid)
    if (!seller) { reply.status(404).send({ error: 'Seller not found' }); return null }
    return seller
  }
  // Isolation choke point: resolve :id as a return OWNED by this seller.
  async function requireOwnedReturn(request: FastifyRequest, reply: FastifyReply, seller: Seller) {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) { reply.status(400).send({ error: 'Invalid return ID' }); return null }
    const ret = await getSellerReturnById(id, seller.id)
    if (!ret) { reply.status(404).send({ error: 'Return not found' }); return null }
    return ret
  }

  // GET /portal/sellers/returns — list (status filter, newest first)
  fastify.get('/portal/sellers/returns', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const q = request.query as Record<string, string>
    const status = ['requested', 'approved', 'rejected', 'pickup_scheduled', 'picked_up', 'received', 'refunded'].includes(q.status) ? q.status : undefined
    const returns = await getSellerReturns(seller.id, status)
    return reply.send({ returns })
  })

  // GET /portal/sellers/returns/:id — detail + timeline
  fastify.get('/portal/sellers/returns/:id', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const ret = await requireOwnedReturn(request, reply, seller); if (!ret) return
    const events = await getOrderEvents(ret.order_id)
    return reply.send({ return: ret, events })
  })

  // Shared: emit order_event + developer webhook for a return transition.
  // The webhook is scoped to the order's owning developer (no cross-developer bleed).
  async function emit(orderId: string, eventType: string, payload: Record<string, unknown>) {
    await createOrderEvent({ order_id: orderId, event_type: eventType, payload }).catch(() => {})
    await fireDeveloperWebhook(eventType, payload, await getOrderDeveloperId(orderId)).catch((err: unknown) => fastify.log.error({ err }, `${eventType} webhook failed`))
  }

  // POST /:id/approve — requested → approved
  fastify.post('/portal/sellers/returns/:id/approve', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const ret = await requireOwnedReturn(request, reply, seller); if (!ret) return
    const updated = await transitionReturn(ret.id, seller.id, 'requested', 'approved')
    if (!updated) return reply.status(409).send({ error: 'Return is not in a requestable state', status: ret.status })
    const order = await getOrderById(ret.order_id)
    sendReturnApprovedEmail(order?.buyer_email ?? null, { product_name: ret.product_name }).catch(() => {})
    await emit(ret.order_id, 'return.approved', { return_id: ret.id, order_id: ret.order_id, status: 'approved' })
    return reply.send({ ok: true, status: 'approved' })
  })

  // POST /:id/reject — requested → rejected (seller_notes required)
  fastify.post('/portal/sellers/returns/:id/reject', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const ret = await requireOwnedReturn(request, reply, seller); if (!ret) return
    const parsed = z.object({ seller_notes: z.string().min(1).max(2000) }).safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A rejection reason (seller_notes) is required' })
    const updated = await transitionReturn(ret.id, seller.id, 'requested', 'rejected', { seller_notes: parsed.data.seller_notes })
    if (!updated) return reply.status(409).send({ error: 'Return is not in a requestable state', status: ret.status })
    const order = await getOrderById(ret.order_id)
    sendReturnRejectedEmail(order?.buyer_email ?? null, { product_name: ret.product_name, seller_notes: parsed.data.seller_notes }).catch(() => {})
    await emit(ret.order_id, 'return.rejected', { return_id: ret.id, order_id: ret.order_id, reason: ret.reason })
    return reply.send({ ok: true, status: 'rejected' })
  })

  // POST /:id/schedule-pickup — approved → pickup_scheduled
  fastify.post('/portal/sellers/returns/:id/schedule-pickup', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const ret = await requireOwnedReturn(request, reply, seller); if (!ret) return
    const parsed = z.object({
      carrier: z.enum(CARRIERS),
      pickup_date: z.string().min(1),
      pickup_tracking_number: z.string().min(1).max(100),
    }).safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })
    const when = new Date(parsed.data.pickup_date)
    if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      return reply.status(400).send({ error: 'Pickup date must be a valid future date' })
    }
    const updated = await transitionReturn(ret.id, seller.id, 'approved', 'pickup_scheduled', {
      pickup_carrier: parsed.data.carrier,
      pickup_date: parsed.data.pickup_date,
      pickup_tracking_number: parsed.data.pickup_tracking_number,
    })
    if (!updated) return reply.status(409).send({ error: 'Return must be approved before scheduling pickup', status: ret.status })
    const order = await getOrderById(ret.order_id)
    sendReturnPickupScheduledEmail(order?.buyer_email ?? null, {
      product_name: ret.product_name, carrier: parsed.data.carrier, pickup_date: parsed.data.pickup_date,
      tracking_number: parsed.data.pickup_tracking_number, address: ret.pickup_address,
    }).catch(() => {})
    await emit(ret.order_id, 'return.pickup_scheduled', {
      return_id: ret.id, order_id: ret.order_id, carrier: parsed.data.carrier,
      pickup_date: parsed.data.pickup_date, tracking_number: parsed.data.pickup_tracking_number,
    })
    return reply.send({ ok: true, status: 'pickup_scheduled' })
  })

  // POST /:id/picked-up — pickup_scheduled → picked_up
  fastify.post('/portal/sellers/returns/:id/picked-up', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const ret = await requireOwnedReturn(request, reply, seller); if (!ret) return
    const updated = await transitionReturn(ret.id, seller.id, 'pickup_scheduled', 'picked_up')
    if (!updated) return reply.status(409).send({ error: 'Pickup must be scheduled first', status: ret.status })
    const order = await getOrderById(ret.order_id)
    sendReturnPickedUpEmail(order?.buyer_email ?? null, { product_name: ret.product_name, carrier: ret.pickup_carrier ?? '', tracking_number: ret.pickup_tracking_number ?? '' }).catch(() => {})
    await emit(ret.order_id, 'return.picked_up', { return_id: ret.id, order_id: ret.order_id })
    return reply.send({ ok: true, status: 'picked_up' })
  })

  // POST /:id/received — picked_up → received (refund recorded, earnings cancelled, order returned)
  fastify.post('/portal/sellers/returns/:id/received', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const ret = await requireOwnedReturn(request, reply, seller); if (!ret) return

    const refundAmount = (await getEarningAmountForOrder(ret.order_id)) ?? 0
    const updated = await transitionReturn(ret.id, seller.id, 'picked_up', 'received', { refund_amount: refundAmount })
    if (!updated) return reply.status(409).send({ error: 'Item must be picked up first', status: ret.status })

    // Seller is not paid for a returned order; the order is marked returned.
    await cancelEarningForOrder(ret.order_id)
    await markOrderReturned(ret.order_id)

    const order = await getOrderById(ret.order_id)
    // A completed return changes the product's quality metrics.
    if (order) recalculateProductQualityScore(order.product_id).catch(() => {})
    sendReturnReceivedEmail(order?.buyer_email ?? null, { product_name: ret.product_name, refund_amount: refundAmount }).catch(() => {})
    await emit(ret.order_id, 'return.received', { return_id: ret.id, order_id: ret.order_id, refund_amount: refundAmount })

    // Auto-suspend: too many recent returns → hide products from search.
    const [recent, total] = await Promise.all([
      countRecentReceivedReturns(seller.id, 30),
      countSellerTotalOrders(seller.id),
    ])
    const rate = total > 0 ? recent / total : 0
    let suspended = false
    if (recent >= 5 || rate > 0.2) {
      await suspendSeller(seller.id)
      suspended = true
      sendSellerSuspendedEmail(seller.email).catch(() => {})
    }
    return reply.send({ ok: true, status: 'received', refund_amount: refundAmount, suspended })
  })

  // ── Return policy settings ──────────────────────────────────────────────────
  fastify.get('/portal/sellers/settings/return-policy', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const policy = await getReturnPolicy(seller.id)
    return reply.send({ return_policy: policy })
  })

  fastify.patch('/portal/sellers/settings/return-policy', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const parsed = z.object({
      window_days: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60)]),
      accepts_returns: z.boolean(),
      return_shipping_paid_by: z.enum(['seller_always', 'buyer_always', 'seller_if_defective']),
    }).safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid policy', details: parsed.error.flatten() })
    await updateReturnPolicy(seller.id, parsed.data)
    return reply.send({ return_policy: parsed.data })
  })
}
