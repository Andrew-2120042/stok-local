import OpenAI from 'npm:openai@4'
import { createClient } from 'npm:@supabase/supabase-js@2'

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

interface ProductRecord {
  id: string
  name: string
  brand: string
  category: string
  description: string
  specs: Record<string, string | number>
}

function buildEmbeddingText(record: ProductRecord): string {
  const specsText = Object.entries(record.specs)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')

  return `${record.name} ${record.brand} ${record.category} ${record.description} ${specsText}`
    .trim()
    .slice(0, 8000)
}

Deno.serve(async (req) => {
  try {
    const { record } = await req.json() as { record: ProductRecord }

    const embeddingText = buildEmbeddingText(record)

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: embeddingText,
      dimensions: 1536,
    })

    const embedding = response.data[0].embedding

    const { error } = await supabase
      .from('products')
      .update({ embedding })
      .eq('id', record.id)

    if (error) throw new Error(`DB update failed: ${error.message}`)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('generate-embedding error:', err)
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
