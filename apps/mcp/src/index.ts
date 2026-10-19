import { McpAgent } from 'agents/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

interface Env {
  STOK_API_BASE: string
  STOK_API_KEY: string
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(Number(amount))
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`
  }
}

async function apiCall(env: Env, method: string, path: string, body?: unknown) {
  const res = await fetch(`${env.STOK_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${env.STOK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const json = await res.json()
  if (!res.ok) {
    throw new Error((json as any).error ?? `API error ${res.status}`)
  }
  return json
}

export class StokMCP extends McpAgent<Env, Record<string, never>, Record<string, never>> {
  server = new McpServer({
    name: 'stok',
    version: '1.0.0',
  })

  async init() {
    // ── Tool 1: search_products ─────────────────────────────────────────────
    this.server.tool(
      'search_products',
      'Search the Stok product catalog using natural language. Returns ranked results with pricing, availability, and seller info.',
      {
        query: z.string().describe('Natural language search query, e.g. "wireless earbuds under 2000"'),
        limit: z.number().int().min(1).max(20).default(5).describe('Max results to return'),
        min_price: z.number().optional().describe('Minimum price filter, in the catalog currency (INR)'),
        max_price: z.number().optional().describe('Maximum price filter, in the catalog currency (INR)'),
        category: z.string().optional().describe('Category filter, e.g. "Wireless Earbuds"'),
      },
      async ({ query, limit, min_price, max_price, category }) => {
        try {
          const data = await apiCall(this.env, 'POST', '/v1/search', {
            query,
            limit,
            filters: {
              ...(min_price !== undefined ? { min_price } : {}),
              ...(max_price !== undefined ? { max_price } : {}),
              ...(category ? { category } : {}),
            },
          }) as any

          if (!data.results?.length) {
            return { content: [{ type: 'text' as const, text: `No products found for: ${query}` }] }
          }

          const lines = [
            `Found ${data.total_results} products for "${query}" (showing ${data.results.length}):`,
            '',
            ...data.results.map((r: any, i: number) =>
              [
                `${i + 1}. **${r.name}** by ${r.brand}`,
                `   Price: ${formatPrice(r.price, r.currency)} | ${r.availability}`,
                `   Category: ${r.category} | Seller: ${r.seller_name} (trust: ${r.seller_trust_score})`,
                `   Delivery: ${r.delivery_eta}`,
                `   ID: ${r.id}`,
                r.specs_summary ? `   Specs: ${r.specs_summary}` : '',
              ].filter(Boolean).join('\n')
            ),
          ]

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Search failed: ${err.message}` }], isError: true }
        }
      }
    )

    // ── Tool 2: create_order ───────────────────────────────────────────────
    this.server.tool(
      'create_order',
      'Create a purchase order for a product. Returns a checkout URL for the buyer to complete payment.',
      {
        product_id: z.string().uuid().describe('Product ID from search_products results'),
        quantity: z.number().int().min(1).max(10).default(1).describe('Number of units to order'),
        session_id: z.string().optional().describe('Optional session ID to group agent interactions'),
      },
      async ({ product_id, quantity, session_id }) => {
        try {
          const data = await apiCall(this.env, 'POST', '/v1/order', {
            product_id,
            quantity,
            session_id,
          }) as any

          const lines = [
            `Order created successfully!`,
            ``,
            `Order ID: ${data.order_id}`,
            `Product: ${data.summary.product_name}`,
            `Quantity: ${data.summary.quantity}`,
            `Total: ${formatPrice(data.summary.total_price, data.summary.currency)}`,
            ``,
            `Checkout URL: ${data.checkout_url}`,
            `Expires in: ${data.expires_in / 60} minutes`,
            ``,
            `Send the checkout URL to the buyer to complete payment.`,
            data.sandbox ? `\n⚠️  This is a sandbox order — no real money will be charged.` : '',
          ].filter((l) => l !== undefined)

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Order failed: ${err.message}` }], isError: true }
        }
      }
    )

    // ── Tool 3: get_order_status ───────────────────────────────────────────
    this.server.tool(
      'get_order_status',
      'Check the current status of an order. Use after create_order to verify payment and track delivery.',
      {
        order_id: z.string().uuid().describe('Order ID returned by create_order'),
      },
      async ({ order_id }) => {
        try {
          const data = await apiCall(this.env, 'GET', `/v1/order/${order_id}`) as any

          const statusEmoji: Record<string, string> = {
            pending_payment: '⏳',
            paid: '✅',
            processing: '🔄',
            shipped: '📦',
            delivered: '🎉',
            cancelled: '❌',
            returned: '↩️',
          }

          const lines = [
            `Order ${order_id.slice(0, 8).toUpperCase()} — ${statusEmoji[data.status] ?? ''} ${data.status.toUpperCase()}`,
            ``,
            `Product: ${data.product.name} (${data.product.brand})`,
            `Quantity: ${data.product.quantity} × ${formatPrice(data.product.unit_price, data.product.currency)} = ${formatPrice(data.product.total_price, data.product.currency)}`,
            `Seller: ${data.seller.name} (trust: ${data.seller.trust_score})`,
          ]

          if (data.tracking_number) {
            lines.push(`Tracking: ${data.tracking_number} via ${data.carrier}`)
          }
          if (data.estimated_delivery) {
            lines.push(`Estimated delivery: ${data.estimated_delivery}`)
          }
          if (data.status === 'pending_payment' && data.expires_at) {
            const expiresIn = Math.round((new Date(data.expires_at).getTime() - Date.now()) / 60000)
            lines.push(`Checkout expires in: ${expiresIn} minutes`)
          }

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `Status check failed: ${err.message}` }], isError: true }
        }
      }
    )
  }
}

export default {
  fetch: StokMCP.mount('/mcp'),
}
