import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../../../../lib/supabase/server'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const res = await fetch(`${process.env.API_BASE_URL}/portal/sellers/returns/${params.id}/picked-up`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-supabase-user-id': user.id, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' }, body: '{}',
  })
  return NextResponse.json(await res.json(), { status: res.status })
}
