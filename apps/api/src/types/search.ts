import { z } from 'zod'

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  // nullish so an explicit JSON null is treated as "no session" (not a 400).
  session_id: z.string().nullish(),
  limit: z.number().int().min(1).max(20).default(10),
  filters: z
    .object({
      min_price: z.number().optional(),
      max_price: z.number().optional(),
      category: z.string().optional(),
      availability: z.enum(['in_stock', 'all']).default('in_stock'),
    })
    .optional(),
})

export type SearchRequest = z.infer<typeof SearchRequestSchema>

export interface ProductResult {
  id: string
  name: string
  brand: string
  category: string
  price: number
  currency: string
  image: string
  availability: string
  delivery_eta: string
  seller_name: string
  seller_trust_score: number
  relevance_score: number
  is_purchasable: boolean
  specs_summary: string
}

export interface SearchResponse {
  results: ProductResult[]
  query: string
  total_results: number
  latency_ms: number
}

// Shapes returned by DB queries
export interface SemanticResult {
  id: string
  name: string
  brand: string
  category: string
  price: number
  currency: string
  images: string[]
  availability: string
  stock: number
  specs: Record<string, unknown>
  seller_name: string
  seller_trust_score: number
  semantic_score: number
  semantic_rank: number
}

export interface KeywordResult {
  id: string
  keyword_score: number
  keyword_rank: number
}

export interface HybridResult extends ProductWithSeller {
  rrf_score: number
  semantic_score: number
  in_keyword: boolean
}

export interface ProductWithSeller {
  id: string
  name: string
  brand: string
  category: string
  price: number
  currency: string
  images: string[]
  availability: string
  stock: number
  specs: Record<string, unknown>
  product_quality_score: number
  seller_name: string
  seller_trust_score: number
}
