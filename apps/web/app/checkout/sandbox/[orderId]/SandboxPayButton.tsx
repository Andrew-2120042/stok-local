'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SandboxPayButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function simulate() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/v1/sandbox/confirm/${orderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Failed to simulate payment')
      }
      router.push(`/checkout/success?order_id=${orderId}&sandbox=true`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 12 }}>
          {error}
        </div>
      )}
      <button
        onClick={simulate}
        disabled={loading}
        style={{
          width: '100%',
          padding: '14px 0',
          background: loading ? '#94a3b8' : '#d97706',
          color: '#fff',
          border: 'none',
          borderRadius: 10,
          fontSize: 16,
          fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
        }}
      >
        {loading ? 'Processing...' : 'Simulate Payment (Sandbox)'}
      </button>
      <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 10 }}>
        This is a test — no real charge will occur
      </p>
    </div>
  )
}
