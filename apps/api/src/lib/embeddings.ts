import crypto from 'crypto'
import OpenAI from 'openai'
import type { Product } from '@stok/types'

export const EMBEDDING_DIMS = 1536

// 'local' (default) needs no API key; 'openai' uses text-embedding-3-small.
// Must match the database's app.embedding_provider (see migration 00022), since
// query vectors and product vectors have to come from the same model.
export function embeddingProvider(): 'local' | 'openai' {
  return process.env.EMBEDDING_PROVIDER === 'openai' ? 'openai' : 'local'
}

let openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set (required when EMBEDDING_PROVIDER=openai)')
    openai = new OpenAI({ apiKey })
  }
  return openai
}

// Deterministic hashing-trick embedding — the TypeScript twin of the SQL
// local_embedding() function in migration 00022. Each word (weight 2) and each
// character trigram of '#word#' (weight 1) is md5-hashed to a dimension and a
// ±1 sign; the result is L2-normalised. Keep the two implementations in sync.
export function localEmbedding(input: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMS).fill(0)
  const add = (feature: string, weight: number) => {
    const h = crypto.createHash('md5').update(feature).digest('hex')
    const idx = parseInt(h.slice(0, 8), 16) % EMBEDDING_DIMS
    v[idx] += parseInt(h[8], 16) < 8 ? weight : -weight
  }

  for (const tok of input.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!tok) continue
    add(`w:${tok}`, 2)
    const padded = `#${tok}#`
    for (let i = 0; i + 3 <= padded.length; i++) add(`g:${padded.slice(i, i + 3)}`, 1)
  }

  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  if (norm === 0) {
    v[0] = 1 // avoid a zero vector (cosine distance would be NaN)
    return v
  }
  return v.map((x) => x / norm)
}

async function openaiEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: EMBEDDING_DIMS,
  })
  return response.data[0].embedding
}

export async function embedQuery(query: string): Promise<number[]> {
  const text = query.trim().slice(0, 8000)
  return embeddingProvider() === 'openai' ? openaiEmbedding(text) : localEmbedding(text)
}

// 60-second in-memory cache — avoids duplicate OpenAI calls for repeated queries
const embeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>()

export async function embedQueryCached(query: string): Promise<number[]> {
  const cached = embeddingCache.get(query)
  if (cached && cached.expiresAt > Date.now()) return cached.embedding

  const embedding = await embedQuery(query)
  embeddingCache.set(query, { embedding, expiresAt: Date.now() + 60_000 })
  return embedding
}

export function buildEmbeddingText(product: Pick<Product, 'name' | 'brand' | 'category' | 'description' | 'specs'>): string {
  const specsText = Object.entries(product.specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')

  return `${product.name} ${product.brand} ${product.category} ${product.description} ${specsText}`
    .trim()
    .slice(0, 8000)
}

export async function generateEmbedding(text: string): Promise<number[]> {
  return embeddingProvider() === 'openai' ? openaiEmbedding(text) : localEmbedding(text)
}

export async function generateProductEmbedding(
  product: Pick<Product, 'name' | 'brand' | 'category' | 'description' | 'specs'>
): Promise<number[]> {
  const text = buildEmbeddingText(product)
  return generateEmbedding(text)
}
