import crypto from 'crypto'

export function generateApiKey(type: 'live' | 'test'): {
  key: string
  hash: string
  prefix: string
} {
  const random = crypto.randomBytes(16).toString('hex')
  const key = `sk_${type}_am_${random}`
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  const prefix = key.slice(0, 16)
  return { key, hash, prefix }
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}
