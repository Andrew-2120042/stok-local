import { calculateTrustScore } from '../apps/api/src/lib/trust'

interface Case {
  label: string
  input: { fulfillment_rate: number; dispute_rate: number; avg_delivery_days: number }
  expected: number | string
}

function showBreakdown(input: { fulfillment_rate: number; dispute_rate: number; avg_delivery_days: number }) {
  const fulfillmentPoints = (input.fulfillment_rate / 100) * 50
  const disputePoints = Math.max(0, 30 - input.dispute_rate * 10)
  let deliveryPoints = 20
  if (input.avg_delivery_days > 2) deliveryPoints = 15
  if (input.avg_delivery_days > 4) deliveryPoints = 10
  if (input.avg_delivery_days > 7) deliveryPoints = 5
  if (input.avg_delivery_days > 14) deliveryPoints = 0
  console.log(`  Breakdown: fulfillment(${fulfillmentPoints}) + dispute(${disputePoints}) + delivery(${deliveryPoints}) = ${fulfillmentPoints + disputePoints + deliveryPoints}`)
}

const cases: Case[] = [
  {
    label: 'Perfect seller',
    input: { fulfillment_rate: 100, dispute_rate: 0, avg_delivery_days: 1 },
    expected: 100,
  },
  {
    label: 'Bad seller',
    input: { fulfillment_rate: 60, dispute_rate: 5, avg_delivery_days: 10 },
    expected: 35, // 30 fulfillment + 0 dispute (5%*10=50, clamped to 0) + 5 delivery (>7d)
  },
  {
    label: 'Average seller',
    input: { fulfillment_rate: 90, dispute_rate: 1, avg_delivery_days: 3 },
    expected: 80, // 45 + 20 + 15
  },
  {
    label: 'Slow but reliable',
    input: { fulfillment_rate: 98, dispute_rate: 0.5, avg_delivery_days: 8 },
    expected: 79, // 49 + 25 + 5
  },
]

let allPass = true
for (const { label, input, expected } of cases) {
  const score = calculateTrustScore(input)
  const pass = score === expected
  if (!pass) allPass = false
  console.log(`${pass ? '✓' : '✗'} ${label}`)
  showBreakdown(input)
  console.log(`  Expected: ${expected}  Got: ${score}  ${pass ? '' : '← FAIL'}`)
  console.log()
}

console.log(allPass ? '✅ All trust score tests passed.' : '❌ Some tests failed.')
