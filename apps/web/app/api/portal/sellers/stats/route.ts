import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/me/stats`, {
    headers: { 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
  })
  const json = await res.json()
  return NextResponse.json(json, { status: res.status })
}
