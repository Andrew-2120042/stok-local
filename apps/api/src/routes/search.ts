import { FastifyInstance } from 'fastify'
import { SearchRequestSchema } from '../types/search'
import { embedQueryCached, embeddingProvider } from '../lib/embeddings'
import { searchHybrid, logSearch } from '../lib/db'
import {
  extractPriceFilter,
  extractCategoryHint,
  extractBrandSignal,
  finalScore,
  buildSpecsSummary,
  deliveryEta,
} from '../lib/search'
import { checkRateLimit, PLAN_LIMITS } from '../lib/ratelimit'

// Out-of-domain gate: if the best semantic match across the catalog is below
// this, the query has no real match and we return an empty result set rather
// than a spurious "closest" product. Calibrated against the catalog embedding
// distribution of each embedding provider:
//   openai — garbage queries top out ~0.21, real matches floor ~0.25
//   local  — off-catalog queries top out ~0.15, real matches floor ~0.19
const MIN_SEMANTIC_SCORE = embeddingProvider() === 'openai' ? 0.22 : 0.17

// Sanitize user input reflected back in responses: HTML-escape special chars
// and neutralize dangerous URI schemes so the echoed query can never carry an
// XSS payload if a consumer renders it unsafely.
function sanitizeEcho(input: string): string {
  return input
    .replace(/javascript:/gi, '')
    .replace(/data:/gi, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.post('/v1/search', async (request, reply) => {
    const start = Date.now()

    // Auth is guaranteed by the preHandler hook in index.ts
    const auth = request.auth!

    // Rate limit check
    const limits = PLAN_LIMITS[auth.plan]
    const rateCheck = checkRateLimit({
      key: `search:${auth.developerId}`,
      limit: limits.searches_per_day,
      windowMs: 24 * 60 * 60 * 1000,
    })

    if (!rateCheck.allowed) {
      return reply.status(429).send({
        error: 'Rate limit exceeded',
        message: `You've used all ${limits.searches_per_day} searches for today`,
        reset_at: new Date(rateCheck.resetAt).toISOString(),
        upgrade_url: 'https://stok.dev/pricing',
      })
    }

    reply.header('X-RateLimit-Limit', String(limits.searches_per_day))
    reply.header('X-RateLimit-Remaining', String(rateCheck.remaining))
    reply.header('X-RateLimit-Reset', String(rateCheck.resetAt))

    const parsed = SearchRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })
    }
    const { query, session_id, limit, filters } = parsed.data

    const priceFilter = {
      ...extractPriceFilter(query),
      ...(filters?.min_price !== undefined ? { min: filters.min_price } : {}),
      ...(filters?.max_price !== undefined ? { max: filters.max_price } : {}),
    }
    const categoryHint = filters?.category ?? extractCategoryHint(query)
    const brandSignal = extractBrandSignal(query)

    const queryEmbedding = await embedQueryCached(query)

    // Sandbox keys search only sandbox products; live keys search only real products
    const candidates = await searchHybrid(
      queryEmbedding,
      query,
      MIN_SEMANTIC_SCORE,
      50,
      auth.isSandbox
    )

    if (candidates.length === 0) {
      const latency_ms = Date.now() - start
      logSearch({
        session_id: session_id ?? null,
        query,
        result_count: 0,
        top_result_id: null,
        latency_ms,
        developer_id: auth.developerId,
      }).catch(() => {})
      return reply.send({ results: [], query: sanitizeEcho(query), total_results: 0, latency_ms })
    }

    const scoredAll = candidates
      .map((product) => {
        const inBudget =
          (!priceFilter.min || product.price >= priceFilter.min) &&
          (!priceFilter.max || product.price <= priceFilter.max)
        const categoryMatch = categoryHint
          ? product.category.toLowerCase() === categoryHint.toLowerCase()
          : false

        return {
          product,
          score: finalScore({
            rrfScore: product.rrf_score,
            sellerTrustScore: product.seller_trust_score,
            productQualityScore: product.product_quality_score,
            categoryMatch,
            categoryHintSet: !!categoryHint,
            brandSignal,
            productBrand: product.brand,
            priceInBudget: inBudget,
          }),
        }
      })
      .sort((a, b) => b.score - a.score)

    // Explicit filters (min_price/max_price) are HARD constraints — unlike
    // natural-language price hints, which only soft-rank. An explicit impossible
    // range therefore yields zero results rather than ranked-down ones.
    const explicitMin = filters?.min_price
    const explicitMax = filters?.max_price
    // Explicit category is also a HARD filter. Normalize so 'wireless_earbuds',
    // 'Wireless Earbuds', 'wireless-earbuds' all match the stored display name.
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')
    const explicitCat = filters?.category ? norm(filters.category) : undefined
    const constrained =
      explicitMin !== undefined || explicitMax !== undefined || explicitCat !== undefined
        ? scoredAll.filter(
            ({ product }) =>
              (explicitMin === undefined || product.price >= explicitMin) &&
              (explicitMax === undefined || product.price <= explicitMax) &&
              (explicitCat === undefined || norm(product.category) === explicitCat)
          )
        : scoredAll
    const scored = constrained.slice(0, limit)

    const maxScore = scored[0]?.score ?? 1
    const results = scored.map(({ product, score }) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: Number(product.price),
      currency: product.currency,
      image: product.images[0] ?? '',
      availability: product.availability,
      delivery_eta: deliveryEta(product.seller_trust_score),
      seller_name: product.seller_name,
      seller_trust_score: product.seller_trust_score,
      relevance_score: Math.round((score / maxScore) * 100) / 100,
      quality_score: product.product_quality_score,
      is_purchasable: product.availability === 'in_stock' && product.stock > 0,
      specs_summary: buildSpecsSummary(product.specs as Record<string, unknown>),
    }))

    const latency_ms = Date.now() - start

    logSearch({
      session_id: session_id ?? null,
      query,
      result_count: results.length,
      top_result_id: results[0]?.id ?? null,
      latency_ms,
      developer_id: auth.developerId,
    }).catch(() => {})

    return reply.send({ results, query: sanitizeEcho(query), total_results: results.length, latency_ms })
  })
}
