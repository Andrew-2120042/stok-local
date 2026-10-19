import 'dotenv/config'
import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false } })

async function run() {
  const client = await pool.connect()
  try {
    // List all tables in the net schema
    const { rows: netTables } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'net'`
    )
    console.log('Tables in net schema:', netTables.map(r => r.table_name).join(', ') || 'none')

    // Check http_request_queue (pending requests)
    const { rows: queue } = await client.query(
      `SELECT id, method, url, status FROM net.http_request_queue ORDER BY id DESC LIMIT 5`
    ).catch(e => { console.log('http_request_queue:', e.message); return { rows: [] as any[] } })

    console.log('\nPending requests in queue:', queue.length)
    queue.forEach(r => console.log(`  [${r.status}] ${r.method} ${r.url}`))

    // Try the response table directly
    const { rows: resp } = await client.query(
      `SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5`
    ).catch(e => { console.log('_http_response error:', e.message); return { rows: [] as any[] } })

    console.log('\nCompleted responses:', resp.length)
    resp.forEach(r => console.log(`  status=${r.status_code} url=${r.url} error=${r.error_msg ?? 'none'}`))

    // Fire a test http_post manually to confirm pg_net works at all
    console.log('\nFiring a manual net.http_post to confirm pg_net is functional...')
    const { rows: testReq } = await client.query(
      `SELECT net.http_post(
         url := current_setting('app.supabase_functions_url') || '/generate-embedding',
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'Authorization', 'Bearer ' || current_setting('app.service_role_key')
         ),
         body := '{"record":{"id":"test","name":"test","brand":"test","category":"test","description":"test","specs":{}}}'::jsonb
       ) AS request_id`
    ).catch(e => { console.log('Manual http_post error:', e.message); return { rows: [] as any[] } })

    if (testReq.length > 0) {
      console.log('Request queued with id:', testReq[0].request_id)
      console.log('Waiting 5s for response...')
      await new Promise(r => setTimeout(r, 5000))

      const { rows: testResp } = await client.query(
        `SELECT status_code, body::text FROM net._http_response WHERE id = $1`,
        [testReq[0].request_id]
      ).catch(() => ({ rows: [] as any[] }))

      if (testResp.length > 0) {
        console.log(`Response: status=${testResp[0].status_code} body=${testResp[0].body?.slice(0, 200)}`)
      } else {
        console.log('No response yet — request may still be queued')
      }
    }
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(err => { console.error(err.message); process.exit(1) })
