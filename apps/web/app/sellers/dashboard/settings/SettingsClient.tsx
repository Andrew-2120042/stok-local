'use client'
import { useEffect, useState } from 'react'

export default function SettingsClient() {
  const [windowDays, setWindowDays] = useState(30)
  const [accepts, setAccepts] = useState(true)
  const [paidBy, setPaidBy] = useState('seller_if_defective')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    fetch('/api/portal/sellers/settings/return-policy').then((r) => r.json()).then((j) => {
      const p = j.return_policy ?? {}
      if (typeof p.window_days === 'number') setWindowDays(p.window_days)
      if (typeof p.accepts_returns === 'boolean') setAccepts(p.accepts_returns)
      if (p.return_shipping_paid_by) setPaidBy(p.return_shipping_paid_by)
      setLoading(false)
    })
  }, [])

  async function save() {
    setSaving(true)
    const res = await fetch('/api/portal/sellers/settings/return-policy', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ window_days: windowDays, accepts_returns: accepts, return_shipping_paid_by: paidBy }),
    })
    setSaving(false)
    if (res.ok) { setToast('Return policy saved'); setTimeout(() => setToast(''), 3000) }
  }

  const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }
  const inp: React.CSSProperties = { padding: '9px 11px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, background: '#fff', minWidth: 220 }

  if (loading) return <div style={{ padding: 28, color: '#64748b' }}>Loading…</div>

  return (
    <div style={{ padding: 28, maxWidth: 560 }}>
      {toast && <div style={{ position: 'fixed', top: 76, right: 28, background: '#0F6E56', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, zIndex: 50 }}>{toast}</div>}
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>Settings</h1>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 22 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Return policy</div>

        <div style={{ marginBottom: 18 }}>
          <label style={lbl}>Return window</label>
          <select style={inp} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
            {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={{ ...lbl, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={accepts} onChange={(e) => setAccepts(e.target.checked)} />
            Accept returns
          </label>
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={lbl}>Who pays return shipping</label>
          <select style={inp} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="seller_always">Seller always</option>
            <option value="buyer_always">Buyer always</option>
            <option value="seller_if_defective">Seller if defective</option>
          </select>
        </div>

        <button onClick={save} disabled={saving} style={{ background: saving ? '#94a3b8' : '#0F6E56', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
