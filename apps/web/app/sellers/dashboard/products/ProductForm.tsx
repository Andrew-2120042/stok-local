'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const CATEGORIES = ['Wireless Earbuds', 'Wired Earphones', 'Phone Chargers', 'Charging Cables', 'Power Banks', 'Phone Cases']
const MAX_IMAGES = 5
const input: React.CSSProperties = { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginTop: 6 }
const labelS: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#374151', display: 'block' }

interface SpecRow { key: string; value: string }

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

export default function ProductForm({ productId }: { productId?: string }) {
  const editing = !!productId
  const router = useRouter()
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('')
  const [availability, setAvailability] = useState('in_stock')
  const [specs, setSpecs] = useState<SpecRow[]>([{ key: '', value: '' }])
  const [images, setImages] = useState<string[]>([])
  const [hasVariants, setHasVariants] = useState(false)
  const [sizes, setSizes] = useState('')
  const [colors, setColors] = useState('')
  const [quality, setQuality] = useState<number | null>(null)

  useEffect(() => {
    if (!editing) return
    ;(async () => {
      const res = await fetch(`/api/portal/sellers/products/${productId}`)
      const json = await res.json()
      if (res.ok && json.product) {
        const p = json.product
        setName(p.name); setBrand(p.brand); setCategory(p.category); setDescription(p.description)
        setPrice(String(p.price)); setStock(String(p.stock)); setAvailability(p.availability)
        setImages(p.images ?? [])
        setQuality(typeof p.product_quality_score === 'number' ? p.product_quality_score : null)
        const sp: Record<string, any> = p.specs ?? {}
        if (Array.isArray(sp.sizes) || Array.isArray(sp.colors)) {
          setHasVariants(true); setSizes((sp.sizes ?? []).join(', ')); setColors((sp.colors ?? []).join(', '))
        }
        const rows = Object.entries(sp).filter(([k]) => k !== 'sizes' && k !== 'colors').map(([key, value]) => ({ key, value: String(value) }))
        setSpecs(rows.length ? rows : [{ key: '', value: '' }])
      }
      setLoading(false)
    })()
  }, [editing, productId])

  function buildSpecs(): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {}
    for (const r of specs) if (r.key.trim()) out[r.key.trim()] = r.value
    if (hasVariants) {
      const s = sizes.split(',').map((x) => x.trim()).filter(Boolean)
      const c = colors.split(',').map((x) => x.trim()).filter(Boolean)
      if (s.length) out.sizes = s
      if (c.length) out.colors = c
    }
    return out
  }

  function validate(): string[] {
    const e: string[] = []
    if (name.trim().length < 3) e.push('Product name must be at least 3 characters')
    if (!brand.trim()) e.push('Brand is required')
    if (description.trim().length < 100) e.push('Description must be at least 100 characters')
    if (!(Number(price) > 0)) e.push('Price must be greater than 0')
    if (!(Number.isInteger(Number(stock)) && Number(stock) >= 0)) e.push('Stock must be a whole number')
    if (Object.keys(buildSpecs()).filter((k) => k !== 'sizes' && k !== 'colors').length === 0) e.push('At least 1 spec is required')
    if (images.length === 0) e.push('At least 1 image is required')
    return e
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (images.length >= MAX_IMAGES) return setErrors([`Maximum ${MAX_IMAGES} images`])
    if (file.size > 5 * 1024 * 1024) return setErrors(['Image too large (max 5MB)'])
    setUploading(true); setErrors([])
    try {
      const dataUrl = await fileToBase64(file)
      const res = await fetch('/api/portal/sellers/products/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: file.type, data_base64: dataUrl }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message ?? json.error ?? 'Upload failed')
      setImages((prev) => [...prev, json.url])
    } catch (err: any) {
      setErrors([err.message])
    } finally { setUploading(false) }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    const v = validate()
    if (v.length) { setErrors(v); window.scrollTo(0, 0); return }
    setSaving(true); setErrors([])
    const body = {
      name: name.trim(), brand: brand.trim(), category, description: description.trim(),
      specs: buildSpecs(), images, price: Number(price), stock: Number(stock), availability,
    }
    const res = editing
      ? await fetch(`/api/portal/sellers/products/${productId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch('/api/portal/sellers/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) { setErrors(json.errors ?? [json.error ?? 'Save failed']); window.scrollTo(0, 0); return }
    router.push('/sellers/dashboard/products')
  }

  if (loading) return <div style={{ padding: 28, color: '#64748b' }}>Loading…</div>

  return (
    <div style={{ padding: 28, maxWidth: 680 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>{editing ? 'Edit product' : 'Add product'}</h1>

      {editing && quality !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 16, color: '#fff',
            background: quality >= 70 ? '#0F6E56' : quality >= 40 ? '#a16207' : '#b91c1c',
          }}>{quality}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Quality score: {quality}/100</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Score updates after orders complete. Lower return rate and repeat buyers increase your score.</div>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 18 }}>
          {errors.map((er, i) => <div key={i} style={{ fontSize: 13, color: '#dc2626' }}>• {er}</div>)}
        </div>
      )}

      <form onSubmit={onSave}>
        <Row><Field label="Product name *"><input style={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} /></Field></Row>
        <Row>
          <Field label="Brand *"><input style={input} value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>
          <Field label="Category *"><select style={input} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </Row>
        <Row><Field label="Description * (min 100 chars — agents read this)">
          <textarea style={{ ...input, minHeight: 96, resize: 'vertical' }} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
          <div style={{ fontSize: 12, color: description.length < 100 ? '#dc2626' : '#64748b', marginTop: 4 }}>{description.length}/5000</div>
        </Field></Row>
        <Row>
          <Field label="Price (₹) *"><input style={input} type="number" value={price} onChange={(e) => setPrice(e.target.value)} min={1} /></Field>
          <Field label="Stock *"><input style={input} type="number" value={stock} onChange={(e) => setStock(e.target.value)} min={0} /></Field>
          <Field label="Availability"><select style={input} value={availability} onChange={(e) => setAvailability(e.target.value)}><option value="in_stock">In stock</option><option value="out_of_stock">Out of stock</option><option value="discontinued">Discontinued</option></select></Field>
        </Row>

        {/* Specs */}
        <div style={{ margin: '18px 0' }}>
          <label style={labelS}>Specs * (at least 1)</label>
          {specs.map((row, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input style={{ ...input, marginTop: 0 }} placeholder="Battery life" value={row.key} onChange={(e) => setSpecs(specs.map((r, j) => j === i ? { ...r, key: e.target.value } : r))} />
              <input style={{ ...input, marginTop: 0 }} placeholder="42 hours" value={row.value} onChange={(e) => setSpecs(specs.map((r, j) => j === i ? { ...r, value: e.target.value } : r))} />
              <button type="button" onClick={() => setSpecs(specs.length > 1 ? specs.filter((_, j) => j !== i) : specs)} style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '0 12px', cursor: 'pointer', color: '#dc2626' }}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setSpecs([...specs, { key: '', value: '' }])} style={{ marginTop: 8, fontSize: 13, color: '#0F6E56', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add spec</button>
        </div>

        {/* Images */}
        <div style={{ margin: '18px 0' }}>
          <label style={labelS}>Images * (min 1, max {MAX_IMAGES}; first is primary)</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            {images.map((url, i) => (
              <div key={url} style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', border: i === 0 ? '2px solid #0F6E56' : '1px solid #e2e8f0' }} />
                {i === 0 && <span style={{ position: 'absolute', bottom: 2, left: 2, background: '#0F6E56', color: '#fff', fontSize: 9, padding: '1px 4px', borderRadius: 4 }}>primary</span>}
                <button type="button" onClick={() => setImages(images.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, background: '#dc2626', color: '#fff', border: 'none', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <label style={{ width: 72, height: 72, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748b', fontSize: 12, textAlign: 'center' }}>
                {uploading ? '…' : '+ Upload'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onUpload} style={{ display: 'none' }} disabled={uploading} />
              </label>
            )}
          </div>
        </div>

        {/* Variants */}
        <div style={{ margin: '18px 0' }}>
          <label style={{ fontSize: 13, color: '#374151', display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={hasVariants} onChange={(e) => setHasVariants(e.target.checked)} />
            This product has variants (size, color)
          </label>
          {hasVariants && (
            <Row>
              <Field label="Sizes (comma separated)"><input style={input} placeholder="S, M, L, XL" value={sizes} onChange={(e) => setSizes(e.target.value)} /></Field>
              <Field label="Colors (comma separated)"><input style={input} placeholder="Black, White" value={colors} onChange={(e) => setColors(e.target.value)} /></Field>
            </Row>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button type="button" onClick={() => router.push('/sellers/dashboard/products')} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={saving || uploading} style={{ padding: '10px 22px', borderRadius: 8, border: 'none', background: saving ? '#94a3b8' : '#0F6E56', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'List product'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ flex: 1 }}><label style={labelS}>{label}</label>{children}</div>
}
