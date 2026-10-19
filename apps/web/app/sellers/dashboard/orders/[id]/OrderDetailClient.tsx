'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN')
const CARRIERS = ['Shiprocket', 'Delhivery', 'BlueDart', 'DTDC', 'India Post', 'Other']
const todayPlus = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)

const EVENT_LABEL: Record<string, string> = {
  'order.created': 'Order placed', 'order.paid': 'Payment received', 'order.processing': 'Marked processing',
  'order.shipped': 'Shipped', 'order.delivered': 'Delivered', 'payment.failed': 'Payment failed',
}

export default function OrderDetailClient({ id }: { id: string }) {
  const [order, setOrder] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // ship form
  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState(CARRIERS[0])
  const [eta, setEta] = useState(todayPlus(3))

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/sellers/orders/${id}`)
    const json = await res.json()
    if (res.ok) { setOrder(json.order); setEvents(json.events ?? []) }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500) }

  async function markProcessing() {
    if (!confirm('Mark this order as processing?')) return
    setBusy(true); setError('')
    const res = await fetch(`/api/portal/sellers/orders/${id}/process`, { method: 'PATCH' })
    setBusy(false)
    if (!res.ok) { const j = await res.json(); setError(j.error ?? 'Failed'); return }
    showToast('Order marked as processing'); load()
  }

  async function confirmShip(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (!tracking.trim()) return setError('Tracking number is required')
    if (eta <= todayPlus(0)) return setError('Estimated delivery must be a future date')
    setBusy(true)
    const res = await fetch(`/api/portal/sellers/orders/${id}/ship`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracking_number: tracking.trim(), carrier, estimated_delivery: eta }),
    })
    setBusy(false)
    const j = await res.json()
    if (!res.ok) { setError(j.error ?? 'Failed to mark shipped'); return }
    setModal(false); showToast('Order marked as shipped — buyer notified'); load()
  }

  if (loading) return <div style={{ padding: 28, color: '#64748b' }}>Loading…</div>
  if (!order) return <div style={{ padding: 28 }}>Order not found. <Link href="/sellers/dashboard/orders" style={{ color: '#0F6E56' }}>Back to orders</Link></div>

  const gross = Number(order.gross_amount ?? order.total_price)
  const fee = Number(order.platform_fee ?? +(gross * 0.1).toFixed(2))
  const payout = Number(order.seller_amount ?? +(gross - fee).toFixed(2))
  const addr = order.shipping_address
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 16 }
  const h3: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }

  return (
    <div style={{ padding: 28, maxWidth: 820 }}>
      {toast && <div style={{ position: 'fixed', top: 76, right: 28, background: '#0F6E56', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>{toast}</div>}

      <Link href="/sellers/dashboard/orders" style={{ fontSize: 13, color: '#0F6E56', textDecoration: 'none' }}>← Orders</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 20px' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>Order {order.id.slice(0, 8).toUpperCase()}</h1>
        {/* Action button by status */}
        {order.status === 'paid' && <button onClick={markProcessing} disabled={busy} style={primaryBtn}>Mark as Processing</button>}
        {order.status === 'processing' && <button onClick={() => setModal(true)} style={primaryBtn}>Mark as Shipped</button>}
        {order.status === 'shipped' && <span style={{ ...statusPill, background: '#e0e7ff', color: '#4338ca' }}>Shipped</span>}
        {order.status === 'delivered' && <span style={{ ...statusPill, background: '#dcfce7', color: '#15803d' }}>Delivered</span>}
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {/* Product */}
      <div style={card}>
        <div style={h3}>Product</div>
        <div style={{ display: 'flex', gap: 14 }}>
          {order.product_images?.[0]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={order.product_images[0]} alt="" style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover' }} />
            : <div style={{ width: 72, height: 72, borderRadius: 8, background: '#f1f5f9' }} />}
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{order.product_name}</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>{order.product_brand} · Qty {order.quantity}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              {Object.entries(order.product_specs ?? {}).filter(([k]) => k !== 'sizes' && k !== 'colors').slice(0, 4).map(([k, v]) => `${k}: ${v}`).join('  ·  ')}
            </div>
          </div>
        </div>
      </div>

      {/* Buyer address — visible because seller is fulfilling */}
      <div style={card}>
        <div style={h3}>Ship to</div>
        {addr ? (
          <div style={{ fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600 }}>{addr.full_name}</div>
            <div>{[addr.line1, addr.line2].filter(Boolean).join(', ')}</div>
            <div>{[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}</div>
            <div>{addr.country}{addr.phone ? `  ·  ${addr.phone}` : ''}</div>
            {order.buyer_email && <div style={{ color: '#64748b', marginTop: 4 }}>{order.buyer_email}</div>}
          </div>
        ) : <div style={{ color: '#94a3b8', fontSize: 14 }}>No shipping address provided.</div>}
      </div>

      {/* Payment breakdown */}
      <div style={card}>
        <div style={h3}>Payment</div>
        <Line label="Gross" value={inr(gross)} />
        <Line label="Platform fee (10%)" value={'– ' + inr(fee)} muted />
        <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 8 }}><Line label="Your payout" value={inr(payout)} bold /></div>
      </div>

      {/* Tracking (if shipped) */}
      {order.tracking_number && (
        <div style={card}>
          <div style={h3}>Tracking</div>
          <Line label="Carrier" value={order.carrier} />
          <Line label="Tracking number" value={order.tracking_number} />
          {order.estimated_delivery && <Line label="Estimated delivery" value={new Date(order.estimated_delivery).toLocaleDateString('en-IN')} />}
        </div>
      )}

      {/* Timeline */}
      <div style={card}>
        <div style={h3}>Timeline</div>
        {events.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 14 }}>No events.</div> : events.map((ev, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#0F6E56', marginTop: 5 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{EVENT_LABEL[ev.event_type] ?? ev.event_type}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{new Date(ev.created_at).toLocaleString('en-IN')}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Ship modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={() => setModal(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={confirmShip} style={{ width: 420, background: '#fff', borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Mark as shipped</div>
            {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <label style={lbl}>Tracking number *<input style={inp} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. 1Z999AA…" /></label>
            <label style={lbl}>Carrier *<select style={inp} value={carrier} onChange={(e) => setCarrier(e.target.value)}>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label style={lbl}>Estimated delivery * (future date)<input style={inp} type="date" min={todayPlus(1)} value={eta} onChange={(e) => setEta(e.target.value)} /></label>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => setModal(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button type="submit" disabled={busy} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: busy ? '#94a3b8' : '#0F6E56', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{busy ? 'Shipping…' : 'Confirm shipment'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

const primaryBtn: React.CSSProperties = { background: '#0F6E56', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const statusPill: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }
const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginTop: 6 }

function Line({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '3px 0' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500, color: bold ? '#0F6E56' : muted ? '#94a3b8' : '#0f172a' }}>{value}</span>
    </div>
  )
}
