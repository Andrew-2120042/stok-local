import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'

async function uid(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser()
  return user?.id ?? null
}

export async function GET(request: NextRequest) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const qs = request.nextUrl.search
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/products${qs}`, {
    headers: { 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' }, cache: 'no-store',
  })
  return NextResponse.json(await res.json(), { status: res.status })
}

export async function POST(request: NextRequest) {
  const userId = await uid()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    body: JSON.stringify(body),
  })
  return NextResponse.json(await res.json(), { status: res.status })
}
