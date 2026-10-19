export interface PriceFilter {
  min?: number
  max?: number
}

export function extractPriceFilter(query: string): PriceFilter {
  const filter: PriceFilter = {}

  const maxMatch = query.match(
    /(?:under|less than|below|upto|up to|max|within)\s*[₹rs.]?\s*(\d[\d,]*)/i
  )
  if (maxMatch) filter.max = parseInt(maxMatch[1].replace(/,/g, ''))

  const minMatch = query.match(
    /(?:above|more than|over|minimum|min|at least)\s*[₹rs.]?\s*(\d[\d,]*)/i
  )
  if (minMatch) filter.min = parseInt(minMatch[1].replace(/,/g, ''))

  const betweenMatch = query.match(
    /between\s*[₹rs.]?\s*(\d[\d,]*)\s*(?:and|to|-)\s*[₹rs.]?\s*(\d[\d,]*)/i
  )
  if (betweenMatch) {
    filter.min = parseInt(betweenMatch[1].replace(/,/g, ''))
    filter.max = parseInt(betweenMatch[2].replace(/,/g, ''))
  }

  return filter
}

const KNOWN_BRANDS = [
  'boat', 'noise', 'oneplus', 'realme', 'anker', 'belkin',
  'spigen', 'otterbox', 'ringke', 'nomad', 'sennheiser', 'jbl',
]

const BRAND_CANONICAL: Record<string, string> = {
  boat: 'boAt', noise: 'Noise', oneplus: 'OnePlus', realme: 'Realme',
  anker: 'Anker', belkin: 'Belkin', spigen: 'Spigen', otterbox: 'OtterBox',
  ringke: 'Ringke', nomad: 'Nomad', sennheiser: 'Sennheiser', jbl: 'JBL',
}

// Patterns that indicate the user wants alternatives TO a brand, not products FROM it.
// "better than boAt" → anti-brand boAt; "alternative to noise" → anti-brand Noise
const ANTI_BRAND_PATTERNS = /\b(?:better than|alternative to|instead of|not|avoid|replace|competitor to|vs)\b/i

export interface BrandSignal {
  brand: string | null
  // true = boost this brand, false = suppress/penalize it
  positive: boolean
}

export function extractBrandSignal(query: string): BrandSignal {
  const lower = query.toLowerCase()
  const isAntiBrand = ANTI_BRAND_PATTERNS.test(query)

  for (const brand of KNOWN_BRANDS) {
    if (lower.includes(brand)) {
      return { brand: BRAND_CANONICAL[brand] ?? brand, positive: !isAntiBrand }
    }
  }
  return { brand: null, positive: true }
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Wireless Earbuds': ['earbuds', 'airpods', 'tws', 'truly wireless', 'buds', 'airdopes', 'neckband'],
  'Wired Earphones': ['earphones', 'wired earphone', 'in-ear', 'bassheads', 'wired headphone'],
  'Phone Chargers': ['charger', 'charging adapter', 'fast charge', 'gan charger', 'wall adapter', 'supervooc', 'dart charge', 'warp charge'],
  'Charging Cables': ['cable', 'usb cable', 'type-c cable', 'lightning cable', 'charging wire', 'powerline'],
  'Power Banks': ['power bank', 'powerbank', 'portable charger', 'battery pack', 'energyshroom', 'powercore'],
  'Phone Cases': ['case', 'cover', 'back cover', 'phone protection', 'tough armor', 'commuter', 'otterbox'],
}

export function extractCategoryHint(query: string): string | null {
  const lower = query.toLowerCase()
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return category
  }
  return null
}

const RRF_K = 60

export function reciprocalRankFusion(
  semanticResults: Array<{ id: string; semantic_rank: number }>,
  keywordResults: Array<{ id: string; keyword_rank: number }>
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const r of semanticResults) {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + r.semantic_rank))
  }
  for (const r of keywordResults) {
    scores.set(r.id, (scores.get(r.id) ?? 0) + 1 / (RRF_K + r.keyword_rank))
  }
  return scores
}

export function finalScore(params: {
  rrfScore: number
  sellerTrustScore: number
  productQualityScore: number
  categoryMatch: boolean
  categoryHintSet: boolean
  brandSignal: BrandSignal
  productBrand: string
  priceInBudget: boolean
}): number {
  let score = params.rrfScore * 1000

  // Trust bonus — up to 10%
  score += (params.sellerTrustScore / 100) * score * 0.1

  // Product quality — up to ±15%. Neutral at 50 (new products), boost above,
  // penalty below.
  const qualityMultiplier = ((params.productQualityScore - 50) / 50) * 0.15
  score += qualityMultiplier * score

  // Category match bonus
  if (params.categoryMatch) score *= 1.15

  // Category mismatch penalty — if user clearly specified a category and this product
  // is in a different one, rank it down significantly
  if (params.categoryHintSet && !params.categoryMatch) score *= 0.5

  // Brand signal: boost if positive mention, penalize if anti-brand ("better than X")
  if (params.brandSignal.brand) {
    const isThisBrand = params.productBrand.toLowerCase() === params.brandSignal.brand.toLowerCase()
    if (isThisBrand) {
      score *= params.brandSignal.positive ? 1.4 : 0.2
    }
  }

  // Rank down over-budget results rather than removing them
  if (!params.priceInBudget) score *= 0.3

  return score
}

export function deliveryEta(trustScore: number): string {
  if (trustScore >= 90) return '1-2 days'
  if (trustScore >= 70) return '2-3 days'
  if (trustScore >= 50) return '3-5 days'
  return '5-7 days'
}

export function buildSpecsSummary(specs: Record<string, unknown>): string {
  return Object.entries(specs)
    .slice(0, 4)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')
    .slice(0, 100)
}
