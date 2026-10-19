'use client'
import { useState } from 'react'

interface WebhookMeta {
  id: string
  url: string
  events: string[]
  is_active: boolean
  created_at: string
  secret: string
}

const AVAILABLE_EVENTS = [
  'order.created',
  'order.paid',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
]

export default function WebhooksClient({ initialWebhooks }: { initialWebhooks: WebhookMeta[] }) {
  const [hooks, setHooks] = useState<WebhookMeta[]>(initialWebhooks)
  const [newUrl, setNewUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['order.paid'])
  const [creating, setCreating] = useState(false)
  const [newSecret, setNewSecret] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, string>>({})

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    )
  }

  async function createHook() {
    if (!newUrl || selectedEvents.length === 0) return
    setCreating(true)
    try {
      const res = await fetch('/api/portal/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, events: selectedEvents }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setNewSecret(json.secret)
      setHooks((h) => [json.webhook, ...h])
      setNewUrl('')
      setSelectedEvents(['order.paid'])
    } catch (err: any) {
      alert(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function deleteHook(id: string) {
    if (!confirm('Delete this webhook?')) return
    const res = await fetch(`/api/portal/webhooks/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) setHooks((h) => h.filter((x) => x.id !== id))
  }

  async function testHook(id: string) {
    setTestResults((r) => ({ ...r, [id]: 'sending...' }))
    const res = await fetch(`/api/portal/webhooks/${id}/test`, {
      method: 'POST',
    })
    const json = await res.json()
    setTestResults((r) => ({ ...r, [id]: res.ok ? `✓ ${json.status}` : `✗ ${json.error}` }))
  }

  return (
    <div>
      {newSecret && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>Webhook signing secret — save it now!</div>
          <code style={{ display: 'block', background: '#fff', border: '1px solid #e2e8f0', padding: '10px 14px', borderRadius: 6, fontSize: 13, wordBreak: 'break-all' }}>{newSecret}</code>
          <button onClick={() => setNewSecret(null)} style={{ marginTop: 10, fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Add endpoint</h2>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Endpoint URL</label>
          <input
            type="url"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://your-server.com/webhooks/stok"
            style={{ width: '100%', padding: '9px 12px', borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 8, display: 'block' }}>Events to receive</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AVAILABLE_EVENTS.map((event) => (
              <button
                key={event}
                type="button"
                onClick={() => toggleEvent(event)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 20,
                  border: `1px solid ${selectedEvents.includes(event) ? '#0F6E56' : '#e2e8f0'}`,
                  background: selectedEvents.includes(event) ? '#0F6E56' : '#fff',
                  color: selectedEvents.includes(event) ? '#fff' : '#374151',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {event}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={createHook}
          disabled={creating || !newUrl || selectedEvents.length === 0}
          style={{ padding: '9px 20px', background: creating || !newUrl ? '#94a3b8' : '#0F6E56', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer' }}
        >
          {creating ? 'Creating...' : 'Add endpoint'}
        </button>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {hooks.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>No webhooks yet</div>
        ) : (
          <div>
            {hooks.map((hook, i) => (
              <div key={hook.id} style={{ padding: 20, borderBottom: i < hooks.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <code style={{ fontSize: 13, color: '#1e293b' }}>{hook.url}</code>
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {hook.events.map((ev) => (
                        <span key={ev} style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, background: '#f1f5f9', color: '#374151' }}>{ev}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                    <button
                      onClick={() => testHook(hook.id)}
                      style={{ padding: '6px 14px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer', color: '#374151' }}
                    >
                      {testResults[hook.id] ?? 'Test'}
                    </button>
                    <button
                      onClick={() => deleteHook(hook.id)}
                      style={{ padding: '6px 14px', border: '1px solid #fecaca', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer', color: '#ef4444' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8' }}>Created {new Date(hook.created_at).toLocaleDateString()}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
