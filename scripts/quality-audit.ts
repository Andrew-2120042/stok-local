import 'dotenv/config'
import path from 'path'
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const API = 'http://localhost:3001/v1/search'

async function search(query: string, limit = 10) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  })
  return res.json() as any
}

function row(r: any, i: number) {
  return `  #${i + 1} [${r.relevance_score.toFixed(2)}] ${r.brand} ${r.name.slice(0, 36).padEnd(36)} ₹${String(r.price).padStart(5)} | ${r.category}`
}

async function run() {
  const tests: Array<{ label: string; query: string; check: (d: any) => string }> = [
    {
      label: '1 — Exact model: "OnePlus Nord Buds 2"',
      query: 'OnePlus Nord Buds 2',
      check: (d) => {
        const top = d.results[0]
        if (!top) return '❌ no results'
        const isExact = top.name.includes('Nord Buds 2')
        const scoreOk = top.relevance_score >= 0.95
        return `${isExact ? '✅' : '❌'} #1 is "${top.name}" score=${top.relevance_score} ${scoreOk ? '✅' : '⚠️ score<0.95'}`
      },
    },
    {
      label: '2 — Use-case intent: "earphones for long office calls"',
      query: 'earphones for long office calls',
      check: (d) => {
        const audioCount = d.results.filter((r: any) =>
          ['Wireless Earbuds', 'Wired Earphones'].includes(r.category)
        ).length
        const hasMic = d.results.slice(0, 5).some((r: any) =>
          r.specs_summary.toLowerCase().includes('mic') || r.name.toLowerCase().includes('mic')
        )
        return `${audioCount >= 7 ? '✅' : '❌'} ${audioCount}/10 audio | mic in top 5: ${hasMic ? '✅' : '⚠️'}`
      },
    },
    {
      label: '3 — Budget: "best earbuds under 1000 rupees"',
      query: 'best earbuds under 1000 rupees',
      check: (d) => {
        const topHalf = d.results.slice(0, 5)
        const underBudget = topHalf.filter((r: any) => r.price <= 1000)
        const hasBoat = topHalf.some((r: any) => r.brand === 'boAt')
        const hasNoise = topHalf.some((r: any) => r.brand === 'Noise')
        return `${underBudget.length >= 3 ? '✅' : '❌'} ${underBudget.length}/5 under ₹1000 | boAt=${hasBoat ? '✅' : '❌'} Noise=${hasNoise ? '✅' : '❌'}`
      },
    },
    {
      label: '4 — Premium: "premium noise cancelling earbuds"',
      query: 'premium noise cancelling earbuds',
      check: (d) => {
        const topHalf = d.results.slice(0, 5)
        const hasANC = topHalf.some((r: any) =>
          r.specs_summary.toLowerCase().includes('anc') ||
          r.name.toLowerCase().includes('anc') ||
          r.name.toLowerCase().includes('noise cancell')
        )
        const avgPrice = topHalf.reduce((s: number, r: any) => s + r.price, 0) / topHalf.length
        return `${hasANC ? '✅' : '❌'} ANC in top 5 | avg price ₹${Math.round(avgPrice)} ${avgPrice > 2000 ? '✅' : '⚠️ low'}`
      },
    },
    {
      label: '5 — Cable search: "fast charging type c cable"',
      query: 'fast charging type c cable',
      check: (d) => {
        const cables = d.results.filter((r: any) => r.category === 'Charging Cables').length
        const notChargers = d.results.filter((r: any) => r.category === 'Phone Chargers').length
        return `${cables >= 5 ? '✅' : '❌'} ${cables} cables | ${notChargers} chargers ${notChargers <= 2 ? '✅' : '⚠️ too many chargers'}`
      },
    },
    {
      label: '6 — Power bank: "portable battery for travel"',
      query: 'portable battery for travel',
      check: (d) => {
        const banks = d.results.filter((r: any) => r.category === 'Power Banks').length
        const top3banks = d.results.slice(0, 3).filter((r: any) => r.category === 'Power Banks').length
        return `${top3banks >= 2 ? '✅' : '❌'} ${banks} power banks total, ${top3banks} in top 3`
      },
    },
    {
      label: '7 — Price ambiguity: "something under 500"',
      query: 'something under 500',
      check: (d) => {
        const topHalf = d.results.slice(0, 5)
        const under500 = topHalf.filter((r: any) => r.price <= 500).length
        const highScore = topHalf.filter((r: any) => r.price > 500 && r.relevance_score > 0.5).length
        return `${under500 >= 3 ? '✅' : '❌'} ${under500}/5 under ₹500 in top 5 | high-score over-budget: ${highScore} ${highScore === 0 ? '✅' : '⚠️'}`
      },
    },
    {
      label: '8 — Competitor: "something better than boAt"',
      query: 'something better than boAt',
      check: (d) => {
        const boat = d.results.filter((r: any) => r.brand === 'boAt').length
        const premium = d.results.slice(0, 5).filter((r: any) =>
          ['Anker', 'OnePlus', 'Noise', 'Sennheiser', 'JBL', 'Belkin'].includes(r.brand)
        ).length
        return `${boat <= 2 ? '✅' : '⚠️'} boAt in results: ${boat} | premium alt brands in top 5: ${premium} ${premium >= 3 ? '✅' : '⚠️'}`
      },
    },
  ]

  // Warm cache
  for (const t of tests) await search(t.query)
  console.log('─'.repeat(70))
  console.log('PHASE 2 QUALITY AUDIT — cached latency')
  console.log('─'.repeat(70))

  for (const t of tests) {
    const d = await search(t.query)
    console.log(`\n${t.label}`)
    console.log(`latency=${d.latency_ms}ms  results=${d.total_results}`)
    d.results.forEach((r: any, i: number) => console.log(row(r, i)))
    console.log(t.check(d))
  }
}

run().catch(e => { console.error(e.message); process.exit(1) })
