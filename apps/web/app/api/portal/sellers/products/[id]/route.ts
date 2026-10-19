import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../../../lib/supabase/server'

async function uid(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser()
  return user?.id ?? null
}
const base = (id: string) => `${process.env.API_BASE_URL}/portal/sellers/products/${id}`

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await fetch(base(params.id), { headers: { 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' }, cache: 'no-store' })
  return NextResponse.json(await res.json(), { status: res.status })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const res = await fetch(base(params.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    body: JSON.stringify(body),
  })
  return NextResponse.json(await res.json(), { status: res.status })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await fetch(base(params.id), { method: 'DELETE', headers: { 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' } })
  return NextResponse.json(await res.json(), { status: res.status })
}
