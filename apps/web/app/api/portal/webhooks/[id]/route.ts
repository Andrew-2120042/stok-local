import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'

async function getUserId(): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const res = await fetch(`${process.env.API_BASE_URL}/portal/webhooks/${params.id}`, {
    method: 'DELETE',
    headers: { 'x-supabase-user-id': userId, 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' },
  })
  const json = await res.json()
  return NextResponse.json(json, { status: res.status })
}
