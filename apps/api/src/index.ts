import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

import crypto from 'crypto'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyRawBody from 'fastify-raw-body'
import { searchRoutes } from './routes/search'
import { orderRoutes } from './routes/order'
import { webhookRoutes } from './routes/webhooks'
import { sandboxRoutes } from './routes/sandbox'
import { portalRoutes } from './routes/portal'
import { sellerPortalRoutes } from './routes/seller-portal'
import { sellerProductRoutes } from './routes/seller-products'
import { sellerOrderRoutes } from './routes/seller-orders'
import { returnRoutes } from './routes/returns'
import { sellerReturnRoutes } from './routes/seller-returns'
import { cancelExpiredOrders } from './lib/db'
import { requireAuth } from './middleware/auth'

const internalSecret = process.env.INTERNAL_API_SECRET || ''
if (!internalSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('INTERNAL_API_SECRET must be set in production (protects /portal/* routes)')
    process.exit(1)
  }
  console.warn('⚠️  INTERNAL_API_SECRET is not set — /portal/* accepts x-supabase-user-id from any caller (dev only)')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  },
})

async function start() {
  await fastify.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: false,
    runFirst: true,
  })

  await fastify.register(cors, { origin: true })
  await fastify.register(helmet)

  fastify.addHook('onResponse', async (request, reply) => {
    fastify.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      latency: Math.round(reply.elapsedTime),
    })
  })

  // Observability + consistent error contract:
  //  - X-Response-Time on every response
  //  - every 4xx/5xx body is JSON shaped { error, message } (never a naked
  //    string or HTML), so clients can parse errors uniformly.
  fastify.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Response-Time', `${Math.round(reply.elapsedTime)}ms`)
    if (reply.statusCode < 400) return payload
    if (typeof payload === 'string') {
      let body: any = null
      try { body = JSON.parse(payload) } catch { /* not JSON */ }
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        if (typeof body.error !== 'string') body.error = body.error ? String(body.error) : 'Error'
        if (typeof body.message !== 'string') body.message = body.error
        return JSON.stringify(body)
      }
      // Naked string / HTML error → wrap as JSON.
      reply.header('content-type', 'application/json; charset=utf-8')
      const text = payload.replace(/<[^>]*>/g, '').trim().slice(0, 300) || 'Error'
      return JSON.stringify({ error: text, message: text })
    }
    return payload
  })

  // Unexpected errors: log the details, but never leak internals (DB hosts,
  // driver messages, stack traces) to the caller. Only 4xx errors raised by
  // Fastify itself (bad JSON, body too large) keep their message — a library
  // error that happens to carry a statusCode (e.g. Stripe's 401) is still ours.
  fastify.setErrorHandler((err, request, reply) => {
    const isRequestError = (err.code?.startsWith('FST_') || err.validation || err instanceof SyntaxError) &&
      !!err.statusCode && err.statusCode >= 400 && err.statusCode < 500
    const status = isRequestError ? err.statusCode! : 500
    if (status >= 500) {
      request.log.error({ err }, 'Unhandled error')
      return reply.status(status).send({ error: 'Internal Server Error', message: 'Something went wrong. Please try again.' })
    }
    return reply.status(status).send({ error: err.name || 'Bad Request', message: err.message })
  })

  // Auth hook: protect all /v1/* except:
  //  - /v1/webhooks/ (Stripe HMAC-verified)
  //  - GET  /v1/order/:id  (used by checkout page server component)
  //  - PATCH /v1/order/:id/details (used by checkout page JS form)
  fastify.addHook('preHandler', async (request, reply) => {
    const url = request.url
    const method = request.method

    if (!url.startsWith('/v1/')) return
    if (url.startsWith('/v1/webhooks/')) return

    // Checkout page reads order without API key (Next.js server-side fetch)
    const isOrderRead = method === 'GET' && /^\/v1\/order\/[^/]+$/.test(url)
    const isOrderDetails = method === 'PATCH' && /^\/v1\/order\/[^/]+\/details$/.test(url)
    // Sandbox confirm is called from the checkout UI (no API key in browser)
    const isSandboxConfirm = method === 'POST' && url.startsWith('/v1/sandbox/confirm/')
    if (isOrderRead || isOrderDetails || isSandboxConfirm) return

    await requireAuth(request, reply)
  })

  // Portal auth hook: /portal/* trusts the x-supabase-user-id header, which only
  // the Next.js server may set (after verifying the Supabase session). Require
  // the shared INTERNAL_API_SECRET so the header can't be forged by anyone who
  // can reach this port directly.
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/portal/')) return
    if (!internalSecret) return // dev only — refused at startup in production
    const provided = request.headers['x-internal-secret']
    if (typeof provided !== 'string' || !safeEqual(provided, internalSecret)) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Portal routes are only callable by the Stok web server',
      })
    }
  })

  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))

  await fastify.register(searchRoutes)
  await fastify.register(orderRoutes)
  await fastify.register(webhookRoutes)
  await fastify.register(sandboxRoutes)
  await fastify.register(portalRoutes)
  await fastify.register(sellerPortalRoutes)
  await fastify.register(sellerProductRoutes)
  await fastify.register(sellerOrderRoutes)
  await fastify.register(returnRoutes)
  await fastify.register(sellerReturnRoutes)

  setInterval(() => {
    cancelExpiredOrders().catch((err) =>
      fastify.log.error({ err }, 'Failed to cancel expired orders')
    )
  }, 5 * 60 * 1000)

  const port = Number(process.env.API_PORT) || 3001
  await fastify.listen({ port, host: '0.0.0.0' })
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})




