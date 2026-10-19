'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN')
const CARRIERS = ['Shiprocket', 'Delhivery', 'BlueDart', 'DTDC', 'India Post', 'Other']
const todayPlus = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
const EVENT_LABEL: Record<string, string> = {
  'order.created': 'Order placed', 'order.paid': 'Payment received', 'order.shipped': 'Shipped',
  'return.requested': 'Return requested', 'return.approved': 'Return approved', 'return.rejected': 'Return rejected',
  'return.pickup_scheduled': 'Pickup scheduled', 'return.picked_up': 'Picked up', 'return.received': 'Item received',
}

export default function ReturnDetailClient({ id }: { id: string }) {
  const [ret, setRet] = useState<any>(null)
  const [events, setEvents] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState<'reject' | 'pickup' | null>(null)
  const [notes, setNotes] = useState('')
  const [carrier, setCarrier] = useState(CARRIERS[0])
  const [pickupDate, setPickupDate] = useState(todayPlus(2))
  const [tracking, setTracking] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/sellers/returns/${id}`)
    const json = await res.json()
    if (res.ok) { setRet(json.return); setEvents(json.events ?? []) }
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3500) }

  async function action(pathname: string, body?: any, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return
    setBusy(true); setError('')
    const res = await fetch(`/api/portal/sellers/returns/${id}/${pathname}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    })
    setBusy(false)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j.error ?? 'Action failed'); return }
    setModal(null)
    showToast(j.suspended ? 'Item received — note: store auto-suspended (return rate)' : 'Updated')
    load()
  }

  if (loading) return <div style={{ padding: 28, color: '#64748b' }}>Loading…</div>
  if (!ret) return <div style={{ padding: 28 }}>Return not found. <Link href="/sellers/dashboard/returns" style={{ color: '#0F6E56' }}>Back</Link></div>

  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 18, marginBottom: 16 }
  const h3: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 12 }
  const addr = ret.pickup_address

  return (
    <div style={{ padding: 28, maxWidth: 760 }}>
      {toast && <div style={{ position: 'fixed', top: 76, right: 28, background: '#0F6E56', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>{toast}</div>}
      <Link href="/sellers/dashboard/returns" style={{ fontSize: 13, color: '#0F6E56', textDecoration: 'none' }}>← Returns</Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 20px' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>Return {ret.id.slice(0, 8).toUpperCase()}</h1>
          <div style={{ fontSize: 13, color: '#64748b' }}>{ret.product_name} · reason: {ret.reason.replace(/_/g, ' ')}</div>
        </div>
        {/* Status-driven actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          {ret.status === 'requested' && <>
            <button onClick={() => action('approve', {}, 'Approve this return and arrange pickup?')} disabled={busy} style={primaryBtn}>Approve</button>
            <button onClick={() => setModal('reject')} disabled={busy} style={dangerBtn}>Reject</button>
          </>}
          {ret.status === 'approved' && <button onClick={() => setModal('pickup')} disabled={busy} style={primaryBtn}>Schedule Pickup</button>}
          {ret.status === 'pickup_scheduled' && <button onClick={() => action('picked-up', {}, 'Mark this package as picked up?')} disabled={busy} style={primaryBtn}>Mark as Picked Up</button>}
          {ret.status === 'picked_up' && <button onClick={() => action('received', {}, 'Confirm you received the item? This cancels the seller payout and records the refund.')} disabled={busy} style={primaryBtn}>Mark as Received</button>}
          {ret.status === 'received' && <span style={{ ...pill, background: '#fef9c3', color: '#a16207' }}>Refund pending</span>}
          {ret.status === 'rejected' && <span style={{ ...pill, background: '#fee2e2', color: '#b91c1c' }}>Rejected</span>}
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {ret.status === 'rejected' && ret.seller_notes && (
        <div style={card}><div style={h3}>Rejection reason</div><div style={{ fontSize: 14 }}>{ret.seller_notes}</div></div>
      )}

      {ret.status === 'received' && (
        <div style={card}><div style={h3}>Refund</div>
          <div style={{ fontSize: 14 }}>Refund amount: <strong style={{ color: '#0F6E56' }}>{inr(ret.refund_amount ?? 0)}</strong></div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Refund will be processed within 5–7 business days. (Stripe refund deferred — recorded only.)</div>
        </div>
      )}

      {['pickup_scheduled', 'picked_up', 'received', 'refunded'].includes(ret.status) && (
        <div style={card}><div style={h3}>Pickup</div>
          <Line label="Carrier" value={ret.pickup_carrier} />
          <Line label="Tracking" value={ret.pickup_tracking_number} />
          {ret.pickup_date && <Line label="Pickup date" value={new Date(ret.pickup_date).toLocaleDateString('en-IN')} />}
        </div>
      )}

      <div style={card}><div style={h3}>Pickup address</div>
        {addr ? <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600 }}>{addr.full_name}</div>
          <div>{[addr.line1, addr.line2].filter(Boolean).join(', ')}</div>
          <div>{[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}</div>
        </div> : <div style={{ color: '#94a3b8', fontSize: 14 }}>No address snapshot.</div>}
      </div>

      <div style={card}><div style={h3}>Timeline</div>
        {events.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 14 }}>No events.</div> : events.map((ev, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: '#0F6E56', marginTop: 5 }} />
            <div><div style={{ fontSize: 14, fontWeight: 600 }}>{EVENT_LABEL[ev.event_type] ?? ev.event_type}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{new Date(ev.created_at).toLocaleString('en-IN')}</div></div>
          </div>
        ))}
      </div>

      {/* Reject modal */}
      {modal === 'reject' && (
        <Modal onClose={() => setModal(null)} title="Reject return">
          {error && <ErrBox e={error} />}
          <label style={lbl}>Reason for rejection *<textarea style={{ ...inp, minHeight: 80 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain why this return is declined (buyer will see this)" /></label>
          <ModalButtons busy={busy} onCancel={() => setModal(null)} onConfirm={() => { if (!notes.trim()) { setError('Reason is required'); return } action('reject', { seller_notes: notes.trim() }) }} confirmLabel="Reject return" />
        </Modal>
      )}

      {/* Schedule pickup modal */}
      {modal === 'pickup' && (
        <Modal onClose={() => setModal(null)} title="Schedule pickup">
          {error && <ErrBox e={error} />}
          <label style={lbl}>Carrier *<select style={inp} value={carrier} onChange={(e) => setCarrier(e.target.value)}>{CARRIERS.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label style={lbl}>Pickup date * (future)<input style={inp} type="date" min={todayPlus(1)} value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} /></label>
          <label style={lbl}>Tracking number *<input style={inp} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. PICK123456" /></label>
          <ModalButtons busy={busy} onCancel={() => setModal(null)} onConfirm={() => {
            if (!tracking.trim()) { setError('Tracking number is required'); return }
            if (pickupDate <= todayPlus(0)) { setError('Pickup date must be in the future'); return }
            action('schedule-pickup', { carrier, pickup_date: new Date(pickupDate + 'T10:00:00').toISOString(), pickup_tracking_number: tracking.trim() })
          }} confirmLabel="Schedule pickup" />
        </Modal>
      )}
    </div>
  )
}

const primaryBtn: React.CSSProperties = { background: '#0F6E56', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const dangerBtn: React.CSSProperties = { background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }
const pill: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }
const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginTop: 6 }

function Line({ label, value }: { label: string; value: any }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '3px 0' }}><span style={{ color: '#64748b' }}>{label}</span><span style={{ fontWeight: 500 }}>{value ?? '—'}</span></div>
}
function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }} onClick={onClose}>
    <div onClick={(e) => e.stopPropagation()} style={{ width: 420, background: '#fff', borderRadius: 12, padding: 24 }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{title}</div>{children}
    </div></div>
}
function ModalButtons({ busy, onCancel, onConfirm, confirmLabel }: { busy: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel: string }) {
  return <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
    <button type="button" onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
    <button type="button" onClick={onConfirm} disabled={busy} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: busy ? '#94a3b8' : '#0F6E56', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{busy ? '…' : confirmLabel}</button>
  </div>
}
function ErrBox({ e }: { e: string }) { return <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{e}</div> }
