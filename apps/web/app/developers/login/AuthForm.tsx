'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase/client'

export default function AuthForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [newKeys, setNewKeys] = useState<{ live: string; test: string } | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
    marginTop: 6,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: '#374151',
    display: 'block',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
        if (signUpError) throw signUpError
        if (!data.user) throw new Error('Signup failed')

        // Create developer record + auto-generate keys
        const res = await fetch('/api/portal/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supabase_user_id: data.user.id, email, name }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed to create developer account')

        setNewKeys(json.keys)
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
        router.push('/developers/dashboard')
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  if (newKeys) {
    return (
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Welcome to Stok!</div>
        <p style={{ fontSize: 14, color: '#374151', marginBottom: 16 }}>
          Your account is created. Save these keys — they are shown <strong>only once</strong>:
        </p>
        {(['live', 'test'] as const).map((type) => (
          <div key={type} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: type === 'live' ? '#0F6E56' : '#7c3aed', marginBottom: 4 }}>
              {type === 'live' ? 'Live Key' : 'Test Key'}
            </div>
            <code style={{ display: 'block', background: '#f1f5f9', padding: '8px 12px', borderRadius: 6, fontSize: 12, wordBreak: 'break-all' }}>
              {newKeys[type]}
            </code>
          </div>
        ))}
        <button
          onClick={() => router.push('/developers/dashboard')}
          style={{ width: '100%', marginTop: 16, background: '#0F6E56', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >
          Go to Dashboard
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      {mode === 'signup' && (
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Name</label>
          <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>Email</label>
        <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Password</label>
        <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={8} />
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#dc2626', marginBottom: 14 }}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{ width: '100%', background: loading ? '#94a3b8' : '#0F6E56', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
      >
        {loading ? 'Loading...' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>

      <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: '#64748b' }}>
        {mode === 'login' ? (
          <>No account?{' '}
            <button type="button" onClick={() => setMode('signup')} style={{ color: '#0F6E56', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Sign up
            </button>
          </>
        ) : (
          <>Already have an account?{' '}
            <button type="button" onClick={() => setMode('login')} style={{ color: '#0F6E56', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              Sign in
            </button>
          </>
        )}
      </div>
    </form>
  )
}
