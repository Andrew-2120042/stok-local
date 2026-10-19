import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Storage not configured: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    client = createClient(url, key)
  }
  return client
}

export async function uploadFile(
  bucket: string,
  path: string,
  file: Buffer,
  contentType: string
): Promise<string> {
  const { error } = await getClient().storage.from(bucket).upload(path, file, {
    contentType,
    upsert: true,
  })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return getPublicUrl(bucket, path)
}

export function getPublicUrl(bucket: string, path: string): string {
  const storageUrl = process.env.STORAGE_URL
  if (storageUrl) return `${storageUrl}/${bucket}/${path}`
  const { data } = getClient().storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

export async function deleteFile(bucket: string, path: string): Promise<void> {
  const { error } = await getClient().storage.from(bucket).remove([path])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}

// Idempotently ensure a public image bucket exists (used for product-images).
export async function ensureBucket(
  bucket: string,
  opts: { public?: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] } = {}
): Promise<{ created: boolean }> {
  const storage = getClient().storage
  const { data: existing } = await storage.getBucket(bucket)
  if (existing) return { created: false }
  const { error } = await storage.createBucket(bucket, {
    public: opts.public ?? true,
    fileSizeLimit: opts.fileSizeLimit ?? 5 * 1024 * 1024, // 5MB
    allowedMimeTypes: opts.allowedMimeTypes ?? ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  })
  if (error) throw new Error(`Bucket create failed: ${error.message}`)
  return { created: true }
}
