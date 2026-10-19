'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Product {
  id: string; name: string; brand: string; category: string; price: number; stock: number
  availability: string; product_quality_score: number; images: string[]
}

const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN')
const badge = (a: string): React.CSSProperties => {
  const map: Record<string, [string, string]> = {
    in_stock: ['#dcfce7', '#15803d'], out_of_stock: ['#fef9c3', '#a16207'], discontinued: ['#f1f5f9', '#64748b'],
  }
  const [bg, fg] = map[a] ?? ['#f1f5f9', '#64748b']
  return { background: bg, color: fg, padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600 }
}

export default function ProductsClient() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [availability, setAvailability] = useState('')
  const [sort, setSort] = useState('created_at')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError('')
    const params = new URLSearchParams({ sort, order })
    if (availability) params.set('availability', availability)
    const res = await fetch(`/api/portal/sellers/products?${params}`)
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to load'); setProducts([]); return }
    setProducts(json.products)
  }, [availability, sort, order])

  useEffect(() => { load() }, [load])

  async function del(id: string, name: string) {
    if (!confirm(`Delete "${name}"? It will be removed from search. This cannot be undone.`)) return
    setBusy(id)
    const res = await fetch(`/api/portal/sellers/products/${id}`, { method: 'DELETE' })
    setBusy(null)
    if (!res.ok) { const j = await res.json(); setError(j.error ?? 'Delete failed'); return }
    load()
  }

  const th: React.CSSProperties = { textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 14, borderBottom: '1px solid #f1f5f9', color: '#0f172a' }
  const sel: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, background: '#fff' }

  return (
    <div style={{ padding: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>Products</h1>
        <Link href="/sellers/dashboard/products/new" style={{ background: '#0F6E56', color: '#fff', padding: '9px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          + Add product
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <select style={sel} value={availability} onChange={(e) => setAvailability(e.target.value)}>
          <option value="">All availability</option>
          <option value="in_stock">In stock</option>
          <option value="out_of_stock">Out of stock</option>
          <option value="discontinued">Discontinued</option>
        </select>
        <select style={sel} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="created_at">Newest</option>
          <option value="price">Price</option>
          <option value="stock">Stock</option>
          <option value="quality_score">Quality score</option>
        </select>
        <select style={sel} value={order} onChange={(e) => setOrder(e.target.value as any)}>
          <option value="desc">High → low</option>
          <option value="asc">Low → high</option>
        </select>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {products === null ? (
        <div style={{ color: '#64748b', fontSize: 14 }}>Loading…</div>
      ) : products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>No products yet</div>
          <div style={{ fontSize: 14, color: '#64748b', marginBottom: 18 }}>List your first product so agents can find and buy it.</div>
          <Link href="/sellers/dashboard/products/new" style={{ background: '#0F6E56', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>+ Add your first product</Link>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}></th><th style={th}>Name</th><th style={th}>Price</th><th style={th}>Stock</th>
              <th style={th}>Availability</th><th style={th}>Quality</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td style={td}>
                    {p.images?.[0]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.images[0]} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', background: '#f1f5f9' }} />
                      : <div style={{ width: 36, height: 36, borderRadius: 6, background: '#f1f5f9' }} />}
                  </td>
                  <td style={td}><div style={{ fontWeight: 600 }}>{p.name}</div><div style={{ fontSize: 12, color: '#64748b' }}>{p.brand} · {p.category}</div></td>
                  <td style={td}>{inr(p.price)}</td>
                  <td style={td}>{p.stock}</td>
                  <td style={td}><span style={badge(p.availability)}>{p.availability.replace('_', ' ')}</span></td>
                  <td style={td}>{p.product_quality_score}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link href={`/sellers/dashboard/products/${p.id}/edit`} style={{ color: '#0F6E56', fontSize: 13, fontWeight: 600, marginRight: 14, textDecoration: 'none' }}>Edit</Link>
                    <button onClick={() => del(p.id, p.name)} disabled={busy === p.id} style={{ color: '#dc2626', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>
                      {busy === p.id ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
