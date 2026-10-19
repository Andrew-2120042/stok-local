import { getProductQualityMetrics, setProductQualityScore, type QualityMetrics } from './db'

// Product quality score (0-100). New/low-volume products sit at the neutral 50
// until there's enough signal (5+ orders) to compute a real score.
export function calculateProductQualityScore(metrics: QualityMetrics): number {
  // Need a minimum of 5 orders before the score moves from the neutral default.
  if (metrics.total_orders < 5) return 50

  // Return rate: 0-40 points (lower return rate = better).
  const returnRate = (metrics.return_count / metrics.total_orders) * 100
  const returnPoints = Math.max(0, 40 - returnRate * 4)

  // Repeat purchase rate: 0-35 points.
  const repeatRate = metrics.total_buyers > 0
    ? (metrics.repeat_buyers / metrics.total_buyers) * 100
    : 0
  const repeatPoints = (repeatRate / 100) * 35

  // Volume confidence bonus: 0-25 points (more orders → more confidence).
  const volumePoints = Math.min(25, Math.floor(metrics.total_orders / 10) * 5)

  return Math.round(returnPoints + repeatPoints + volumePoints)
}

// Recompute and persist a product's quality score from current DB metrics.
// Fire-and-forget at the call sites (order paid, return received, repeat purchase).
export async function recalculateProductQualityScore(productId: string): Promise<number> {
  const metrics = await getProductQualityMetrics(productId)
  const score = calculateProductQualityScore(metrics)
  await setProductQualityScore(productId, score)
  return score
}
