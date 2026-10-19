import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'

async function getUserId(): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function GET() {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/me`, {
    headers: { 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
  })
  const json = await res.json()
  return NextResponse.json(json, { status: res.status })
}

export async function PATCH(request: NextRequest) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json()
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  return NextResponse.json(json, { status: res.status })
}
