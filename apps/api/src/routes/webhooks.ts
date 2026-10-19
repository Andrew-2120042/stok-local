import Stripe from 'stripe'
import { FastifyInstance } from 'fastify'
import {
  getOrderByPaymentIntentId,
  getOrderById,
  markOrderPaidIfPending,
  createOrderEvent,
  decrementStockIfAvailable,
  createSellerEarning,
} from '../lib/db'
import { recalculateTrustScore } from '../lib/trust'
import { recalculateProductQualityScore } from '../lib/quality'
import { fireDeveloperWebhook } from '../lib/developer-webhooks'
import { sendOrderConfirmedEmail, sendSellerNewOrderEmail } from '../lib/email'

let _stripe: Stripe | null = null
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any })
  return _stripe
}

export async function webhookRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/v1/webhooks/stripe',
    { config: { rawBody: true } },
    async (request, reply) => {
      const sig = request.headers['stripe-signature']

      if (!sig) {
        return reply.status(400).send({ error: 'Missing stripe-signature header' })
      }

      let event: Stripe.Event

      try {
        event = getStripe().webhooks.constructEvent(
          request.rawBody as Buffer,
          sig as string,
          process.env.STRIPE_WEBHOOK_SECRET!
        )
      } catch (err) {
        fastify.log.warn({ err }, 'Stripe webhook signature verification failed')
        return reply.status(400).send({ error: 'Invalid signature' })
      }

      // Always return 200 immediately — if processing fails, log it, don't fail Stripe's retry
      reply.status(200).send({ received: true })

      try {
        await handleStripeEvent(event, fastify)
      } catch (err) {
        fastify.log.error({ err, eventId: event.id, eventType: event.type }, 'Webhook processing error')
      }
    }
  )
}

async function handleStripeEvent(event: Stripe.Event, fastify: FastifyInstance) {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSuccess(event.data.object as Stripe.PaymentIntent, fastify)
      break

    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
      break

    default:
      fastify.log.info({ eventType: event.type }, 'Unhandled Stripe event')
  }
}

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent, fastify: FastifyInstance) {
  const { product_id, quantity, session_id } = paymentIntent.metadata

  const order = await getOrderByPaymentIntentId(paymentIntent.id)
  if (!order) {
    fastify.log.warn({ paymentIntentId: paymentIntent.id }, 'Order not found for payment_intent')
    return
  }

  // Idempotency + concurrency: Stripe can fire the same event multiple times,
  // possibly in parallel. The atomic transition guarantees only one delivery
  // decrements stock and emits order.paid.
  const won = await markOrderPaidIfPending(order.id)
  if (!won) return

  await createOrderEvent({
    order_id: order.id,
    event_type: 'order.paid',
    payload: { payment_intent_id: paymentIntent.id, amount: paymentIntent.amount },
  })

  // Atomic reserve — never oversell. (Real payment already captured; on a true
  // oversell this would need a refund — deferred, see STRIPE_TODO.md.)
  const reserved = await decrementStockIfAvailable(product_id, Number(quantity))
  if (!reserved) fastify.log.warn({ orderId: order.id, product_id }, 'oversold — stock not decremented (refund needed)')

  // Record what the seller is owed (ledger — see STRIPE_TODO.md).
  await createSellerEarning({
    seller_id: order.seller_id,
    order_id: order.id,
    gross_amount: Number(order.total_price),
  }).catch((err: unknown) => fastify.log.error({ err }, 'seller earning insert failed'))

  await recalculateTrustScore(order.seller_id)
  recalculateProductQualityScore(product_id).catch((err: unknown) => fastify.log.error({ err }, 'quality recalc failed'))

  await fireDeveloperWebhook('order.confirmed', {
    order_id: order.id,
    status: 'paid',
    product_id,
    quantity: Number(quantity),
    session_id,
  }, order.developer_id).catch((err: unknown) => fastify.log.error({ err }, 'Developer webhook fire failed'))

  // Fetch enriched order for emails (non-blocking)
  getOrderById(order.id).then((full) => {
    if (!full) return
    sendOrderConfirmedEmail(full).catch(console.error)
    sendSellerNewOrderEmail(full).catch(console.error)
  })
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const order = await getOrderByPaymentIntentId(paymentIntent.id)
  if (!order) return

  await createOrderEvent({
    order_id: order.id,
    event_type: 'payment.failed',
    payload: {
      payment_intent_id: paymentIntent.id,
      error: paymentIntent.last_payment_error?.message ?? 'unknown',
    },
  })
}

