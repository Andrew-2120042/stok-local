'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN')
const STATUS_COLORS: Record<string, [string, string]> = {
  pending_payment: ['#f1f5f9', '#64748b'], paid: ['#dbeafe', '#1d4ed8'], processing: ['#fef9c3', '#a16207'],
  shipped: ['#e0e7ff', '#4338ca'], delivered: ['#dcfce7', '#15803d'], cancelled: ['#fee2e2', '#b91c1c'],
}
function badge(s: string): React.CSSProperties {
  const [bg, fg] = STATUS_COLORS[s] ?? ['#f1f5f9', '#64748b']
  return { background: bg, color: fg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }
}

export default function OrdersClient() {
  const router = useRouter()
  const [orders, setOrders] = useState<any[] | null>(null)
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ sort })
    if (status) params.set('status', status)
    const res = await fetch(`/api/portal/sellers/orders?${params}`)
    const json = await res.json()
    setOrders(json.orders ?? [])
    setTotal(json.total ?? 0)
  }, [status, sort])
  useEffect(() => { load() }, [load])

  const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f1f5f9', color: '#0f172a' }
  const sel: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, background: '#fff' }

  return (
    <div style={{ padding: 28 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Orders {total > 0 && <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>({total})</span>}</h1>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select style={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="paid">Paid</option><option value="processing">Processing</option><option value="shipped">Shipped</option><option value="delivered">Delivered</option>
        </select>
        <select style={sel} value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        </select>
      </div>

      {orders === null ? <div style={{ color: '#64748b' }}>Loading…</div> : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, color: '#64748b' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 6 }}>No orders yet</div>
          <div style={{ fontSize: 14 }}>Orders from agents appear here once buyers pay.</div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Order</th><th style={th}></th><th style={th}>Product</th><th style={th}>Qty</th>
              <th style={th}>Your payout</th><th style={th}>Ship to</th><th style={th}>Status</th><th style={th}>Date</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} onClick={() => router.push(`/sellers/dashboard/orders/${o.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600 }}>{o.id.slice(0, 8).toUpperCase()}</td>
                  <td style={td}>{o.product_image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={o.product_image} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover' }} />
                    : <div style={{ width: 34, height: 34, borderRadius: 6, background: '#f1f5f9' }} />}</td>
                  <td style={td}>{o.product_name}</td>
                  <td style={td}>{o.quantity}</td>
                  <td style={{ ...td, fontWeight: 600, color: '#0F6E56' }}>{inr(o.seller_amount)}</td>
                  <td style={td}>{[o.buyer_city, o.buyer_state].filter(Boolean).join(', ') || '—'}</td>
                  <td style={td}><span style={badge(o.status)}>{o.status.replace('_', ' ')}</span></td>
                  <td style={{ ...td, color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(o.created_at).toLocaleDateString('en-IN')}</td>
                  <td style={{ ...td, color: '#0F6E56', fontWeight: 600 }}>View →</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
