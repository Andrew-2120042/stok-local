'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../lib/supabase/client'

const input: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0',
  fontSize: 14, outline: 'none', boxSizing: 'border-box', marginTop: 6,
}
const label: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: '#374151', display: 'block' }
const btn = (loading: boolean): React.CSSProperties => ({
  width: '100%', background: loading ? '#94a3b8' : '#0F6E56', color: '#fff', border: 'none',
  borderRadius: 8, padding: '11px 0', fontSize: 15, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
})

export default function SellerAuthForm({ initialMode = 'login' }: { initialMode?: 'login' | 'signup' }) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode)
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [businessType, setBusinessType] = useState<'individual' | 'company'>('individual')
  const [gst, setGst] = useState('')
  const [description, setDescription] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError
      router.push('/sellers/dashboard')
    } catch (err: any) {
      setError(err.message ?? 'Sign in failed')
    } finally { setLoading(false) }
  }

  function nextStep(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError('Store name is required')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    setStep(2)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      if (description.trim().length < 20)
        throw new Error('Store description should be at least 20 characters (agents see this)')
      const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error('Signup failed')

      const res = await fetch('/api/portal/sellers/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabase_user_id: data.user.id,
          name, email, phone,
          business_type: businessType,
          gst_number: gst || undefined,
          description,
          address: { city, state, country: 'IN' },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create seller account')
      router.push('/sellers/dashboard')
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong')
    } finally { setLoading(false) }
  }

  // ── Login ──
  if (mode === 'login') {
    return (
      <form onSubmit={handleLogin}>
        <Field label="Email"><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@store.com" required /></Field>
        <Field label="Password"><input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required /></Field>
        <ErrorBox error={error} />
        <button type="submit" disabled={loading} style={btn(loading)}>{loading ? 'Loading…' : 'Sign in'}</button>
        <Toggle text="New seller?" cta="Create a store" onClick={() => { setMode('signup'); setStep(1); setError('') }} />
      </form>
    )
  }

  // ── Signup step 1: account ──
  if (step === 1) {
    return (
      <form onSubmit={nextStep}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Step 1 of 2 — Account</div>
        <Field label="Store name *"><input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Audio" required /></Field>
        <Field label="Email *"><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@store.com" required /></Field>
        <Field label="Password *"><input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" required minLength={8} /></Field>
        <Field label="Phone"><input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" /></Field>
        <Field label="Business type *">
          <select style={input} value={businessType} onChange={(e) => setBusinessType(e.target.value as any)}>
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </select>
        </Field>
        <Field label="GST number (optional)"><input style={input} value={gst} onChange={(e) => setGst(e.target.value)} placeholder="22AAAAA0000A1Z5" /></Field>
        <ErrorBox error={error} />
        <button type="submit" style={btn(false)}>Continue</button>
        <Toggle text="Already have a store?" cta="Sign in" onClick={() => { setMode('login'); setError('') }} />
      </form>
    )
  }

  // ── Signup step 2: business details ──
  return (
    <form onSubmit={handleSignup}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Step 2 of 2 — Business details</div>
      <Field label="Store description * (shown to agents)">
        <textarea style={{ ...input, minHeight: 80, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What you sell and why agents should buy from you" required />
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="City"><input style={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Hyderabad" /></Field>
        <Field label="State"><input style={input} value={state} onChange={(e) => setState(e.target.value)} placeholder="Telangana" /></Field>
      </div>
      <ErrorBox error={error} />
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button type="button" onClick={() => { setStep(1); setError('') }} style={{ ...btn(false), background: '#e2e8f0', color: '#0f172a', flex: '0 0 90px' }}>Back</button>
        <button type="submit" disabled={loading} style={btn(loading)}>{loading ? 'Creating…' : 'Create store'}</button>
      </div>
    </form>
  )
}

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 14, flex: 1 }}><label style={label}>{l}</label>{children}</div>
}
function ErrorBox({ error }: { error: string }) {
  if (!error) return null
  return <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#dc2626', marginBottom: 14 }}>{error}</div>
}
function Toggle({ text, cta, onClick }: { text: string; cta: string; onClick: () => void }) {
  return (
    <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: '#64748b' }}>
      {text}{' '}
      <button type="button" onClick={onClick} style={{ color: '#0F6E56', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>{cta}</button>
    </div>
  )
}
