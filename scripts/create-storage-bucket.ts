import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })
import { ensureBucket, uploadFile, deleteFile, getPublicUrl } from '../apps/api/src/lib/storage'

async function run() {
  const bucket = 'product-images'
  const res = await ensureBucket(bucket, { public: true })
  console.log(`bucket "${bucket}": ${res.created ? 'CREATED' : 'already exists'}`)

  // Verify writeability + public URL with a tiny test object.
  const testPath = `_healthcheck/${Date.now()}.txt`
  const url = await uploadFile(bucket, testPath, Buffer.from('ok'), 'text/plain')
  const fetched = await fetch(url).then((r) => r.text()).catch(() => '')
  console.log(`upload → ${url}`)
  console.log(`public fetch returns: "${fetched}" (expect "ok")`)
  await deleteFile(bucket, testPath)
  console.log('test object cleaned up. bucket is accessible ✓')
}
run().catch((e) => { console.error('BUCKET ERROR:', e.message); process.exit(1) })
