'use client'
import { useState } from 'react'

interface ApiKeyMeta {
  id: string
  name: string
  prefix: string
  is_sandbox: boolean
  last_used_at: string | null
  created_at: string
}

export default function KeysClient({ initialKeys }: { initialKeys: ApiKeyMeta[] }) {
  const [keys, setKeys] = useState<ApiKeyMeta[]>(initialKeys)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [isSandbox, setIsSandbox] = useState(false)

  async function createKey() {
    setCreating(true)
    try {
      const res = await fetch('/api/portal/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName || 'My Key', is_sandbox: isSandbox }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setNewKey(json.key)

      // Reload keys
      const listRes = await fetch('/api/portal/keys')
      const { keys: updated } = await listRes.json()
      setKeys(updated)
      setNewKeyName('')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    if (!confirm('Revoke this key? All requests using it will fail immediately.')) return
    const res = await fetch(`/api/portal/keys/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) setKeys((k) => k.filter((x) => x.id !== id))
  }

  return (
    <div>
      {newKey && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#16a34a', marginBottom: 8 }}>New key created — save it now!</div>
          <code style={{ display: 'block', background: '#fff', border: '1px solid #e2e8f0', padding: '10px 14px', borderRadius: 6, fontSize: 13, wordBreak: 'break-all' }}>{newKey}</code>
          <button onClick={() => setNewKey(null)} style={{ marginTop: 10, fontSize: 13, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 10, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Create new key</h2>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Key name</label>
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="My Key"
              style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 13 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#374151', display: 'block', marginBottom: 4 }}>Type</label>
            <select
              value={isSandbox ? 'test' : 'live'}
              onChange={(e) => setIsSandbox(e.target.value === 'test')}
              style={{ padding: '8px 12px', borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 13 }}
            >
              <option value="live">Live</option>
              <option value="test">Test (Sandbox)</option>
            </select>
          </div>
          <button
            onClick={createKey}
            disabled={creating}
            style={{ padding: '9px 20px', background: creating ? '#94a3b8' : '#0F6E56', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer' }}
          >
            {creating ? 'Creating...' : 'Create key'}
          </button>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {keys.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>No API keys yet</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: '#f8fafc' }}>
              <tr>
                {['Name', 'Key prefix', 'Type', 'Last used', 'Created', ''].map((h) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500 }}>{key.name}</td>
                  <td style={{ padding: '12px 16px' }}><code style={{ fontSize: 12 }}>{key.prefix}...</code></td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: key.is_sandbox ? '#f3e8ff' : '#dcfce7', color: key.is_sandbox ? '#7c3aed' : '#16a34a' }}>
                      {key.is_sandbox ? 'TEST' : 'LIVE'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>{new Date(key.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <button
                      onClick={() => revokeKey(key.id)}
                      style={{ color: '#ef4444', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
