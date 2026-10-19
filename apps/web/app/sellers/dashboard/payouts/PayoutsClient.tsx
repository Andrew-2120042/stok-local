'use client'
import { useEffect, useState } from 'react'

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN')

export default function PayoutsClient() {
  const [data, setData] = useState<any>(null)
  useEffect(() => { fetch('/api/portal/sellers/earnings').then((r) => r.json()).then(setData) }, [])

  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f1f5f9' }
  const th: React.CSSProperties = { ...td, textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }
  const t = data?.totals ?? {}

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Payouts</h1>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>
        Earnings ledger. Actual bank transfers arrive in a later phase — see roadmap.
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <Card label="Total earned" value={inr(t.total_earned ?? 0)} accent />
        <Card label="Pending payout" value={inr(t.pending_payout ?? 0)} />
        <Card label="Paid out" value={inr(t.paid_out ?? 0)} />
      </div>

      {!data ? <div style={{ color: '#64748b' }}>Loading…</div> : (data.earnings ?? []).length === 0 ? (
        <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 40, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
          No earnings yet. They appear here once your orders are paid.
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Product</th><th style={th}>Gross</th><th style={th}>Fee</th><th style={th}>You earn</th><th style={th}>Status</th><th style={th}>Date</th></tr></thead>
            <tbody>
              {data.earnings.map((e: any) => (
                <tr key={e.id}>
                  <td style={td}>{e.product_name}</td>
                  <td style={td}>{inr(e.gross_amount)}</td>
                  <td style={td}>{inr(e.platform_fee)}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#0F6E56' }}>{inr(e.seller_amount)}</td>
                  <td style={td}><span style={{ background: e.status === 'paid' ? '#dcfce7' : '#fef9c3', color: e.status === 'paid' ? '#15803d' : '#a16207', padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>{e.status}</span></td>
                  <td style={{ ...td, color: '#64748b' }}>{new Date(e.created_at).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Card({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? '#0F6E56' : '#0f172a' }}>{value}</div>
    </div>
  )
}
