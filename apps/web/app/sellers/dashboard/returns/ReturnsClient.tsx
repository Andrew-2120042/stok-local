'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const STATUS_COLORS: Record<string, [string, string]> = {
  requested: ['#fef9c3', '#a16207'], approved: ['#dbeafe', '#1d4ed8'], rejected: ['#fee2e2', '#b91c1c'],
  pickup_scheduled: ['#e0e7ff', '#4338ca'], picked_up: ['#e0e7ff', '#4338ca'], received: ['#dcfce7', '#15803d'], refunded: ['#dcfce7', '#15803d'],
}
function badge(s: string): React.CSSProperties {
  const [bg, fg] = STATUS_COLORS[s] ?? ['#f1f5f9', '#64748b']
  return { background: bg, color: fg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }
}
const reasonLabel = (r: string) => r.replace(/_/g, ' ')

export default function ReturnsClient() {
  const router = useRouter()
  const [returns, setReturns] = useState<any[] | null>(null)
  const [status, setStatus] = useState('')

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    const res = await fetch(`/api/portal/sellers/returns?${params}`)
    const json = await res.json()
    setReturns(json.returns ?? [])
  }, [status])
  useEffect(() => { load() }, [load])

  const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f1f5f9', color: '#0f172a' }

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Returns</h1>
      <select style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, background: '#fff', marginBottom: 16 }} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All</option><option value="requested">Requested</option><option value="approved">Approved</option>
        <option value="rejected">Rejected</option><option value="pickup_scheduled">Pickup scheduled</option>
        <option value="picked_up">Picked up</option><option value="received">Received</option>
      </select>

      {returns === null ? <div style={{ color: '#64748b' }}>Loading…</div> : returns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, color: '#64748b' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>No return requests yet</div>
          <div style={{ fontSize: 14 }}>Returns initiated by buyers appear here for you to review.</div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Return</th><th style={th}>Order</th><th style={th}>Product</th><th style={th}>Reason</th><th style={th}>Status</th><th style={th}>Date</th><th style={th}></th></tr></thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/sellers/dashboard/returns/${r.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{r.id.slice(0, 8).toUpperCase()}</td>
                  <td style={{ ...td, fontFamily: 'monospace', color: '#64748b' }}>{r.order_id.slice(0, 8).toUpperCase()}</td>
                  <td style={td}>{r.product_name}</td>
                  <td style={td}><span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>{reasonLabel(r.reason)}</span></td>
                  <td style={td}><span style={badge(r.status)}>{r.status.replace(/_/g, ' ')}</span></td>
                  <td style={{ ...td, color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{ ...td, color: '#0F6E56', fontWeight: 600 }}>Review →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
