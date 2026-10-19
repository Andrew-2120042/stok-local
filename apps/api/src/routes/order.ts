import Stripe from 'stripe'
import { FastifyInstance } from 'fastify'
import { CreateOrderSchema, UpdateOrderDetailsSchema } from '../types/order'
import type { OrderStatusResponse } from '../types/order'
import {
  getProductWithSeller,
  createOrder,
  createOrderEvent,
  getOrderById,
  updateOrderDetails,
  getPendingOrder,
  isRepeatPurchase,
} from '../lib/db'
import type { Order } from '@stok/types'
import { resolveAuth } from '../middleware/auth'
import { checkRateLimit, PLAN_LIMITS } from '../lib/ratelimit'
import { recalculateProductQualityScore } from '../lib/quality'

// Recompute quality if this order is a repeat purchase of the same product by
// the same session (repeat buyers raise the score). Fire-and-forget.
function recalcIfRepeat(sessionId: string, productId: string) {
  isRepeatPurchase(sessionId, productId)
    .then((repeat) => { if (repeat) recalculateProductQualityScore(productId).catch(() => {}) })
    .catch(() => {})
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Build the POST /v1/order success payload from a persisted order. Shared by the
// create path and the idempotent-replay path so retries return an identical shape.
function buildOrderResponse(order: Order, productName: string, idempotent: boolean) {
  const isSandbox = order.is_sandbox
  const checkoutUrl = isSandbox
    ? `${process.env.CHECKOUT_BASE_URL}/checkout/sandbox/${order.id}`
    : `${process.env.CHECKOUT_BASE_URL}/checkout/${order.id}`
  const expiresIn = order.expires_at
    ? Math.max(0, Math.round((new Date(order.expires_at).getTime() - Date.now()) / 1000))
    : 900
  return {
    order_id: order.id,
    checkout_url: checkoutUrl,
    expires_in: expiresIn,
    ...(isSandbox
      ? { sandbox: true, note: 'This is a sandbox order. No real payment will be charged.' }
      : {}),
    ...(idempotent ? { idempotent: true } : {}),
    summary: {
      product_name: productName,
      quantity: order.quantity,
      total_price: Number(order.total_price),
      currency: order.currency,
    },
  }
}

let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any })
  return _stripe
}

export async function orderRoutes(fastify: FastifyInstance) {
  fastify.post('/v1/order', async (request, reply) => {
    const auth = request.auth!

    // Rate limit
    const limits = PLAN_LIMITS[auth.plan]
    const rateCheck = checkRateLimit({
      key: `order:${auth.developerId}`,
      limit: limits.orders_per_day,
      windowMs: 24 * 60 * 60 * 1000,
    })

    if (!rateCheck.allowed) {
      return reply.status(429).send({
        error: 'Rate limit exceeded',
        message: `You've used all ${limits.orders_per_day} orders for today`,
        reset_at: new Date(rateCheck.resetAt).toISOString(),
        upgrade_url: 'https://stok.dev/pricing',
      })
    }

    const parsed = CreateOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })
    }

    const { product_id, quantity, session_id, shipping_address } = parsed.data
    const sessionId = session_id ?? crypto.randomUUID()

    // Fetch the product and check for an existing pending order in parallel —
    // both are independent remote-DB reads, so overlapping them shaves a full
    // round-trip off order-creation latency.
    const [product, existingPending] = await Promise.all([
      getProductWithSeller(product_id),
      getPendingOrder(sessionId, product_id),
    ])

    if (!product) {
      return reply.status(404).send({ error: 'Product not found' })
    }

    // Sandbox key must use sandbox products and vice versa
    if (auth.isSandbox && !product.is_sandbox) {
      return reply.status(400).send({
        error: 'Sandbox keys can only order sandbox products',
        code: 'SANDBOX_PRODUCT_REQUIRED',
      })
    }
    if (!auth.isSandbox && product.is_sandbox) {
      return reply.status(400).send({
        error: 'Live keys cannot order sandbox products',
        code: 'LIVE_PRODUCT_REQUIRED',
      })
    }

    if (product.availability !== 'in_stock' || product.stock < quantity) {
      return reply.status(409).send({ error: 'Product out of stock', code: 'OUT_OF_STOCK' })
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    // Idempotency: if this session already has a live pending order for this
    // product, return it instead of creating a duplicate. Lets agents safely
    // retry POST /v1/order. (The DB partial-unique index is the race backstop.)
    if (existingPending) {
      return reply.status(200).send(buildOrderResponse(existingPending, product.name, true))
    }

    // ── Sandbox path — no real Stripe ────────────────────────────────────────
    if (auth.isSandbox) {
      const { order, created } = await createOrder({
        session_id: sessionId,
        product_id,
        seller_id: product.seller_id,
        developer_id: auth.developerId,
        quantity,
        unit_price: Number(product.price),
        total_price: Number(product.price) * quantity,
        currency: 'USD',
        status: 'pending_payment',
        stripe_payment_intent_id: `pi_test_mock_${crypto.randomUUID()}`,
        shipping_address: shipping_address ?? null,
        expires_at: expiresAt,
        is_sandbox: true,
      })

      if (!created) {
        // Lost a concurrent race — return the winning order idempotently.
        return reply.status(200).send(buildOrderResponse(order, product.name, true))
      }

      // Audit event — fire-and-forget so it stays off the response hot path.
      createOrderEvent({
        order_id: order.id,
        event_type: 'order.created',
        payload: { product_id, quantity, session_id: sessionId, sandbox: true },
      }).catch((err) => request.log.error({ err }, 'order.created event failed'))
      recalcIfRepeat(sessionId, product_id)

      return reply.status(201).send(buildOrderResponse(order, product.name, false))
    }

    // ── Live path — real Stripe ───────────────────────────────────────────────
    if (!process.env.STRIPE_SECRET_KEY) {
      return reply.status(503).send({
        error: 'Payments not configured',
        message: 'Live orders need STRIPE_SECRET_KEY. Use a sandbox key (sk_test_am_...) to run the full order flow without Stripe.',
        code: 'PAYMENTS_NOT_CONFIGURED',
      })
    }

    // NOTE: Stripe Connect (transfer_data / seller payout split) is deferred —
    // the buyer is charged into the platform account and what the seller is owed
    // is recorded in the seller_earnings ledger on payment. See STRIPE_TODO.md.
    const unitPrice = Math.round(Number(product.price) * 100)
    const totalAmount = unitPrice * quantity

    const piParams: Record<string, unknown> = {
      amount: totalAmount,
      currency: 'usd',
      description: `Stok purchase — ${product.name}`,
      shipping: {
        name: 'Stok Customer',
        address: { line1: '123 Test Street', city: 'New York', state: 'NY', postal_code: '10001', country: 'US' },
      },
      payment_method_types: ['card'],
      metadata: {
        product_id,
        quantity: String(quantity),
        session_id: sessionId,
      },
    }

    const paymentIntent = await getStripe().paymentIntents.create(piParams as any)

    const { order, created } = await createOrder({
      session_id: sessionId,
      product_id,
      seller_id: product.seller_id,
      developer_id: auth.developerId,
      quantity,
      unit_price: Number(product.price),
      total_price: Number(product.price) * quantity,
      currency: 'USD',
      status: 'pending_payment',
      stripe_payment_intent_id: paymentIntent.id,
      shipping_address: shipping_address ?? null,
      expires_at: expiresAt,
      is_sandbox: false,
    })

    if (!created) {
      // Lost a concurrent race — this request's PaymentIntent is left
      // uncaptured (it simply expires); return the winning order idempotently.
      return reply.status(200).send(buildOrderResponse(order, product.name, true))
    }

    // Audit event — fire-and-forget so it stays off the response hot path.
    createOrderEvent({
      order_id: order.id,
      event_type: 'order.created',
      payload: { product_id, quantity, session_id: sessionId },
    }).catch((err) => request.log.error({ err }, 'order.created event failed'))
    recalcIfRepeat(sessionId, product_id)

    return reply.status(201).send(buildOrderResponse(order, product.name, false))
  })

  fastify.patch('/v1/order/:id/details', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.status(400).send({ error: 'Invalid order ID format' })
    const parsed = UpdateOrderDetailsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })
    }

    const order = await getOrderById(id)
    if (!order) return reply.status(404).send({ error: 'Order not found' })
    if (order.status !== 'pending_payment') {
      return reply.status(409).send({ error: 'Order is not pending payment' })
    }

    await updateOrderDetails(id, {
      buyer_email: parsed.data.buyer_email,
      shipping_address: parsed.data.shipping_address as Record<string, string> | undefined,
    })

    return reply.send({ updated: true })
  })

  fastify.get('/v1/order/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.status(400).send({ error: 'Invalid order ID format' })

    const order = await getOrderById(id)
    if (!order) return reply.status(404).send({ error: 'Order not found' })

    // Capability-URL read (checkout page, no key). But if a valid API key IS
    // supplied, scope to the owning developer — a developer cannot read another
    // developer's order (returns 404 to avoid leaking existence).
    const auth = await resolveAuth(request)
    if (auth && order.developer_id && order.developer_id !== auth.developerId) {
      return reply.status(404).send({ error: 'Order not found' })
    }

    const response: OrderStatusResponse = {
      order_id: order.id,
      status: order.status,
      product: {
        id: order.product_id,
        name: order.product_name,
        image: order.product_image,
        brand: order.product_brand,
        quantity: order.quantity,
        unit_price: Number(order.unit_price),
        total_price: Number(order.total_price),
        currency: order.currency,
        quality_score: order.product_quality_score,
      },
      seller: {
        name: order.seller_name,
        trust_score: order.seller_trust_score,
      },
      shipping_address: order.shipping_address,
      tracking_number: order.tracking_number,
      carrier: order.carrier,
      estimated_delivery: order.estimated_delivery,
      created_at: order.created_at,
      updated_at: order.updated_at,
    }

    if (order.status === 'pending_payment' && order.stripe_payment_intent_id) {
      // Sandbox orders have mock payment intent IDs — don't call Stripe
      if (!order.stripe_payment_intent_id.startsWith('pi_test_mock_')) {
        const paymentIntent = await getStripe().paymentIntents.retrieve(
          order.stripe_payment_intent_id
        )
        response.stripe_client_secret = paymentIntent.client_secret ?? undefined
      }
      response.expires_at = order.expires_at
    }

    return reply.send(response)
  })
}
