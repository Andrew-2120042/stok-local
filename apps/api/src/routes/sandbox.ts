import { FastifyInstance } from 'fastify'
import { getOrderById, markOrderPaidIfPending, createOrderEvent, decrementStockIfAvailable, updateOrderStatus, createSellerEarning } from '../lib/db'
import { fireDeveloperWebhook } from '../lib/developer-webhooks'
import { recalculateProductQualityScore } from '../lib/quality'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function sandboxRoutes(fastify: FastifyInstance) {
  // POST /v1/sandbox/confirm/:orderId — simulate a payment success
  fastify.post('/v1/sandbox/confirm/:orderId', async (request, reply) => {
    // If a live key is passed, reject it — sandbox confirms are for sandbox keys only
    const authHeader = request.headers.authorization
    if (authHeader?.startsWith('Bearer sk_live_am_')) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Live keys cannot confirm sandbox orders. Use a test key (sk_test_am_...).',
      })
    }

    const { orderId } = request.params as { orderId: string }

    if (!UUID_RE.test(orderId)) {
      return reply.status(400).send({ error: 'Invalid order ID format' })
    }
    const order = await getOrderById(orderId)

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' })
    }

    if (!order.is_sandbox) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'This endpoint only works for sandbox orders',
      })
    }

    if (order.status !== 'pending_payment') {
      return reply.status(409).send({
        error: 'Order already processed',
        status: order.status,
      })
    }

    // Atomic transition — only the request that flips pending_payment → paid
    // decrements stock. Concurrent confirms of the same order get false here and
    // return 409 without double-decrementing.
    const won = await markOrderPaidIfPending(orderId, { buyer_email: order.buyer_email })
    if (!won) {
      return reply.status(409).send({ error: 'Order already processed', status: 'paid' })
    }

    // Reserve stock atomically — prevents overselling under concurrency. If the
    // product is out of stock, the payment can't be fulfilled: revert the order
    // to cancelled (in real life this would trigger a refund) and return 409.
    const reserved = await decrementStockIfAvailable(order.product_id, order.quantity)
    if (!reserved) {
      await updateOrderStatus(orderId, 'cancelled')
      await createOrderEvent({ order_id: orderId, event_type: 'order.cancelled', payload: { reason: 'out_of_stock' } }).catch(() => {})
      return reply.status(409).send({ error: 'Product out of stock — payment reversed', code: 'OUT_OF_STOCK' })
    }

    await createOrderEvent({
      order_id: orderId,
      event_type: 'order.paid',
      payload: { source: 'sandbox_confirm', sandbox: true },
    })

    // Record what the seller is owed (ledger — see STRIPE_TODO.md).
    await createSellerEarning({
      seller_id: order.seller_id,
      order_id: orderId,
      gross_amount: Number(order.total_price),
    }).catch(() => {})

    // Sandbox payments emit developer webhooks too, so integrations can be
    // tested end-to-end without real Stripe. Fire-and-forget — never blocks
    // the confirm response.
    fireDeveloperWebhook('order.confirmed', {
      order_id: orderId,
      status: 'paid',
      product_id: order.product_id,
      quantity: order.quantity,
      session_id: order.session_id,
      sandbox: true,
    }, order.developer_id).catch(() => {})

    // An order completing changes the product's quality metrics.
    recalculateProductQualityScore(order.product_id).catch(() => {})

    return reply.send({
      order_id: orderId,
      status: 'paid',
      message: 'Sandbox payment simulated successfully',
    })
  })
}
