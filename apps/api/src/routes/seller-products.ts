import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import crypto from 'crypto'
import {
  getSellerBySupabaseId,
  getSellerProducts,
  getSellerProductById,
  createProduct,
  updateProduct,
  softDeleteProduct,
  appendProductImage,
} from '../lib/db'
import { uploadFile } from '../lib/storage'
import type { Seller } from '@stok/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORIES = [
  'Wireless Earbuds', 'Wired Earphones', 'Phone Chargers',
  'Charging Cables', 'Power Banks', 'Phone Cases',
] as const
const BUCKET = 'product-images'
const MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
}

function sellerUserId(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const v = request.headers['x-supabase-user-id']
  return typeof v === 'string' && v.length > 0 ? v : null
}

// Server-side mirror of the client quality gate. Listings must pass before save.
function validateProductQuality(p: {
  name?: string; description?: string; specs?: Record<string, unknown>; images?: string[]; price?: number
}): string[] {
  const errors: string[] = []
  if (!p.images || p.images.length === 0) errors.push('At least 1 image required')
  if (!p.description || p.description.length < 100) errors.push('Description must be at least 100 characters')
  if (!p.specs || Object.keys(p.specs).length === 0) errors.push('At least 1 spec required')
  if (!p.name || p.name.length < 3) errors.push('Product name too short')
  if (!(typeof p.price === 'number' && p.price > 0)) errors.push('Price must be greater than 0')
  return errors
}

export async function sellerProductRoutes(fastify: FastifyInstance) {
  // Resolve the authenticated seller; sends 401/404 and returns null on failure.
  async function requireSeller(request: FastifyRequest, reply: FastifyReply): Promise<Seller | null> {
    const uid = sellerUserId(request as any)
    if (!uid) { reply.status(401).send({ error: 'Unauthorized' }); return null }
    const seller = await getSellerBySupabaseId(uid)
    if (!seller) { reply.status(404).send({ error: 'Seller not found' }); return null }
    return seller
  }

  // Resolve a :id param as a product OWNED by this seller, else 400/404. This is
  // the single choke point enforcing cross-seller isolation for /:id routes.
  async function requireOwnedProduct(request: FastifyRequest, reply: FastifyReply, seller: Seller) {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) { reply.status(400).send({ error: 'Invalid product ID' }); return null }
    const product = await getSellerProductById(id, seller.id)
    if (!product) { reply.status(404).send({ error: 'Product not found' }); return null }
    return product
  }

  // GET /portal/sellers/products — list this seller's products
  fastify.get('/portal/sellers/products', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const q = request.query as Record<string, string>
    const products = await getSellerProducts(seller.id, {
      availability: ['in_stock', 'out_of_stock', 'discontinued'].includes(q.availability) ? (q.availability as any) : undefined,
      sort: ['price', 'stock', 'quality_score', 'created_at'].includes(q.sort) ? (q.sort as any) : undefined,
      order: q.order === 'asc' ? 'asc' : 'desc',
    })
    return reply.send({ products })
  })

  const productSchema = z.object({
    name: z.string().min(1).max(200),
    brand: z.string().min(1),
    category: z.enum(CATEGORIES),
    description: z.string().min(1).max(5000),
    specs: z.record(z.any()),
    images: z.array(z.string()).max(5).default([]),
    // Cap price so price × max-qty(10) fits orders.total_price numeric(10,2)
    // (max 99,999,999.99) — prevents a numeric-overflow 500.
    price: z.number().max(9999999.99, 'Price exceeds maximum'),
    stock: z.number().int().min(0).max(1000000),
    availability: z.enum(['in_stock', 'out_of_stock', 'discontinued']).optional(),
  })

  // POST /portal/sellers/products — create (quality gate enforced)
  fastify.post('/portal/sellers/products', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const parsed = productSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })

    const errors = validateProductQuality(parsed.data)
    if (errors.length) return reply.status(400).send({ error: 'Quality gate failed', errors })

    const product = await createProduct({ seller_id: seller.id, ...parsed.data })
    return reply.status(201).send({ product })
  })

  // GET /portal/sellers/products/:id — single (ownership enforced)
  fastify.get('/portal/sellers/products/:id', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const product = await requireOwnedProduct(request, reply, seller); if (!product) return
    return reply.send({ product })
  })

  // PATCH /portal/sellers/products/:id — update (ownership + quality gate on merged result)
  fastify.patch('/portal/sellers/products/:id', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const product = await requireOwnedProduct(request, reply, seller); if (!product) return

    const parsed = productSchema.partial().safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() })

    const merged = {
      name: parsed.data.name ?? product.name,
      description: parsed.data.description ?? product.description,
      specs: (parsed.data.specs ?? product.specs) as Record<string, unknown>,
      images: parsed.data.images ?? product.images,
      price: parsed.data.price ?? Number(product.price),
    }
    const errors = validateProductQuality(merged)
    if (errors.length) return reply.status(400).send({ error: 'Quality gate failed', errors })

    await updateProduct(product.id, seller.id, parsed.data)
    const updated = await getSellerProductById(product.id, seller.id)
    return reply.send({ product: updated })
  })

  // DELETE /portal/sellers/products/:id — soft delete (ownership enforced)
  fastify.delete('/portal/sellers/products/:id', async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const product = await requireOwnedProduct(request, reply, seller); if (!product) return
    await softDeleteProduct(product.id, seller.id)
    return reply.send({ deleted: true })
  })

  // Decode a base64 image upload and store it under the seller's namespace.
  const imageSchema = z.object({
    content_type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
    data_base64: z.string().min(1),
  })
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  // Magic-byte signatures so a non-image (e.g. text renamed .jpg) is rejected
  // even if it declares an image content_type.
  function magicMatches(contentType: string, buf: Buffer): boolean {
    if (buf.length < 12) return false
    if (contentType === 'image/png') return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    if (contentType === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    if (contentType === 'image/gif') return buf.slice(0, 3).toString('ascii') === 'GIF'
    if (contentType === 'image/webp') return buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP'
    return false
  }
  // Returns { url } or an error string (400 reason).
  async function storeImage(sellerId: string, contentType: string, base64: string): Promise<{ url?: string; error?: string }> {
    const buf = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64')
    if (buf.length > MAX_IMAGE_BYTES) return { error: 'Image too large (max 5MB)' }
    if (!magicMatches(contentType, buf)) return { error: 'File content does not match the declared image type' }
    const ext = MIME_EXT[contentType]
    const path = `${sellerId}/${crypto.randomUUID()}.${ext}`
    return { url: await uploadFile(BUCKET, path, buf, contentType) }
  }

  // Route-level bodyLimit so legitimate images (up to ~5MB → ~6.7MB base64)
  // are accepted, while the global default stays small for other routes.
  const imageRouteOpts = { bodyLimit: 10 * 1024 * 1024 }

  // POST /portal/sellers/products/images — upload an image not yet tied to a
  // product (used by the "new product" form before the product exists).
  fastify.post('/portal/sellers/products/images', imageRouteOpts, async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const parsed = imageSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid image', details: parsed.error.flatten() })
    try {
      const r = await storeImage(seller.id, parsed.data.content_type, parsed.data.data_base64)
      if (r.error) return reply.status(400).send({ error: r.error })
      return reply.status(201).send({ url: r.url })
    } catch (err: any) {
      fastify.log.error({ err }, 'image upload failed')
      return reply.status(502).send({ error: 'Upload failed', message: err.message })
    }
  })

  // POST /portal/sellers/products/:id/images — upload + append to an existing product
  fastify.post('/portal/sellers/products/:id/images', imageRouteOpts, async (request, reply) => {
    const seller = await requireSeller(request, reply); if (!seller) return
    const product = await requireOwnedProduct(request, reply, seller); if (!product) return
    const parsed = imageSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid image', details: parsed.error.flatten() })
    try {
      const r = await storeImage(seller.id, parsed.data.content_type, parsed.data.data_base64)
      if (r.error) return reply.status(400).send({ error: r.error })
      await appendProductImage(product.id, seller.id, r.url!)
      return reply.status(201).send({ url: r.url })
    } catch (err: any) {
      fastify.log.error({ err }, 'image upload failed')
      return reply.status(502).send({ error: 'Upload failed', message: err.message })
    }
  })
}
