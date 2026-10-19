import { query } from './db'
import type { Seller } from '@stok/types'

export function calculateTrustScore(seller: Pick<Seller, 'fulfillment_rate' | 'dispute_rate' | 'avg_delivery_days'>): number {
  const fulfillmentPoints = (seller.fulfillment_rate / 100) * 50

  const disputePoints = Math.max(0, 30 - seller.dispute_rate * 10)

  let deliveryPoints = 20
  if (seller.avg_delivery_days > 2) deliveryPoints = 15
  if (seller.avg_delivery_days > 4) deliveryPoints = 10
  if (seller.avg_delivery_days > 7) deliveryPoints = 5
  if (seller.avg_delivery_days > 14) deliveryPoints = 0

  return Math.round(fulfillmentPoints + disputePoints + deliveryPoints)
}

export async function recalculateTrustScore(sellerId: string): Promise<number> {
  const { rows } = await query<Pick<Seller, 'fulfillment_rate' | 'dispute_rate' | 'avg_delivery_days'>>(
    `SELECT fulfillment_rate, dispute_rate, avg_delivery_days FROM sellers WHERE id = $1`,
    [sellerId]
  )

  if (rows.length === 0) throw new Error(`Seller ${sellerId} not found`)

  const score = calculateTrustScore(rows[0])

  await query(
    `UPDATE sellers SET trust_score = $1, updated_at = now() WHERE id = $2`,
    [score, sellerId]
  )

  return score
}
