import dotenv from 'dotenv'
import path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env') })

import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const SANDBOX_PRODUCTS = [
  { name: 'Test Widget Alpha', brand: 'TestCo', category: 'electronics', price: 9.99, currency: 'USD', availability: 'in_stock', stock: 100, description: 'Sandbox test product for electronics', specs: { color: 'blue', weight: '100g' } },
  { name: 'Sample Gadget Beta', brand: 'DemoBrand', category: 'electronics', price: 24.99, currency: 'USD', availability: 'in_stock', stock: 50, description: 'Sandbox test product for gadgets', specs: { color: 'black', battery: '2000mAh' } },
  { name: 'Mock Laptop Pro', brand: 'FakeTech', category: 'computers', price: 499.00, currency: 'USD', availability: 'in_stock', stock: 20, description: 'Sandbox test laptop product', specs: { ram: '16GB', storage: '512GB' } },
  { name: 'Test Phone X', brand: 'SandboxPhone', category: 'mobile', price: 299.00, currency: 'USD', availability: 'in_stock', stock: 30, description: 'Sandbox test mobile product', specs: { screen: '6.1 inch', camera: '12MP' } },
  { name: 'Demo Headphones', brand: 'TestAudio', category: 'audio', price: 79.99, currency: 'USD', availability: 'in_stock', stock: 75, description: 'Sandbox test audio product', specs: { type: 'over-ear', wireless: true } },
  { name: 'Sample Running Shoes', brand: 'TestSport', category: 'footwear', price: 59.99, currency: 'USD', availability: 'in_stock', stock: 100, description: 'Sandbox test footwear product', specs: { material: 'mesh', sole: 'rubber' } },
  { name: 'Mock Coffee Maker', brand: 'DemoKitchen', category: 'appliances', price: 49.99, currency: 'USD', availability: 'in_stock', stock: 40, description: 'Sandbox test appliance', specs: { capacity: '12 cups', color: 'silver' } },
  { name: 'Test Backpack', brand: 'FakeBag', category: 'bags', price: 39.99, currency: 'USD', availability: 'in_stock', stock: 60, description: 'Sandbox test bag product', specs: { capacity: '30L', material: 'nylon' } },
  { name: 'Demo Gaming Mouse', brand: 'TestGaming', category: 'peripherals', price: 34.99, currency: 'USD', availability: 'in_stock', stock: 80, description: 'Sandbox test gaming peripheral', specs: { dpi: '16000', buttons: 7 } },
  { name: 'Sample Smart Watch', brand: 'SandboxWear', category: 'wearables', price: 149.99, currency: 'USD', availability: 'in_stock', stock: 25, description: 'Sandbox test wearable', specs: { display: 'AMOLED', battery: '7 days' } },
  { name: 'Mock Desk Chair', brand: 'TestFurniture', category: 'furniture', price: 189.99, currency: 'USD', availability: 'in_stock', stock: 15, description: 'Sandbox test furniture', specs: { material: 'mesh', adjustable: true } },
  { name: 'Test Yoga Mat', brand: 'DemoFitness', category: 'fitness', price: 29.99, currency: 'USD', availability: 'in_stock', stock: 90, description: 'Sandbox test fitness product', specs: { thickness: '6mm', material: 'TPE' } },
  { name: 'Sample Mechanical Keyboard', brand: 'TestPeripherals', category: 'peripherals', price: 89.99, currency: 'USD', availability: 'in_stock', stock: 45, description: 'Sandbox test keyboard', specs: { switches: 'blue', layout: 'TKL' } },
  { name: 'Mock Bluetooth Speaker', brand: 'FakeAudio', category: 'audio', price: 54.99, currency: 'USD', availability: 'in_stock', stock: 55, description: 'Sandbox test speaker', specs: { watts: 20, waterproof: true } },
  { name: 'Test LED Monitor', brand: 'SandboxDisplay', category: 'monitors', price: 249.99, currency: 'USD', availability: 'in_stock', stock: 18, description: 'Sandbox test monitor', specs: { size: '27 inch', resolution: '1440p' } },
  { name: 'Demo USB Hub', brand: 'TestConnectivity', category: 'accessories', price: 19.99, currency: 'USD', availability: 'in_stock', stock: 120, description: 'Sandbox test USB hub', specs: { ports: 7, usb3: true } },
  { name: 'Mock Instant Camera', brand: 'FakePhoto', category: 'cameras', price: 79.99, currency: 'USD', availability: 'in_stock', stock: 35, description: 'Sandbox test camera product', specs: { film: 'mini', flash: 'built-in' } },
  { name: 'Test Portable Charger', brand: 'DemoPower', category: 'accessories', price: 24.99, currency: 'USD', availability: 'in_stock', stock: 85, description: 'Sandbox test power bank', specs: { capacity: '20000mAh', ports: 2 } },
  { name: 'Sample Desk Lamp', brand: 'TestLighting', category: 'home', price: 34.99, currency: 'USD', availability: 'in_stock', stock: 65, description: 'Sandbox test desk lamp', specs: { color_temp: '3000K-6500K', usb: true } },
  { name: 'Mock Resistance Bands', brand: 'SandboxFitness', category: 'fitness', price: 14.99, currency: 'USD', availability: 'in_stock', stock: 150, description: 'Sandbox test fitness bands', specs: { levels: 5, material: 'latex' } },
]

async function seedSandbox() {
  const client = await pool.connect()

  try {
    // Get the first seller to attach sandbox products to
    const { rows: sellers } = await client.query(`SELECT id FROM sellers LIMIT 1`)
    if (!sellers.length) {
      console.error('No sellers found — run seed.ts first')
      process.exit(1)
    }
    const sellerId = sellers[0].id

    // Check how many sandbox products already exist
    const { rows: existing } = await client.query(
      `SELECT COUNT(*) FROM products WHERE is_sandbox = true`
    )
    const count = Number(existing[0].count)
    if (count >= 20) {
      console.log(`Sandbox already has ${count} products — skipping`)
      return
    }

    console.log(`Seeding ${SANDBOX_PRODUCTS.length} sandbox products...`)

    for (const p of SANDBOX_PRODUCTS) {
      await client.query(
        `INSERT INTO products (seller_id, name, brand, category, price, currency, availability, stock, description, specs, images, is_sandbox)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         ON CONFLICT DO NOTHING`,
        [
          sellerId,
          `[TEST] ${p.name}`,
          p.brand,
          p.category,
          p.price,
          p.currency,
          p.availability,
          p.stock,
          p.description,
          JSON.stringify(p.specs),
          '{}',
        ]
      )
    }

    console.log('✅ Sandbox products seeded')
  } finally {
    client.release()
    await pool.end()
  }
}

seedSandbox().catch((err) => {
  console.error(err)
  process.exit(1)
})
