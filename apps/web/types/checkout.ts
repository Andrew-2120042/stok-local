export interface OrderStatusResponse {
  order_id: string
  status: string
  product: {
    id: string
    name: string
    image: string | null
    brand: string
    quantity: number
    unit_price: number
    total_price: number
    currency: string
  }
  seller: {
    name: string
    trust_score: number
  }
  shipping_address: Record<string, string> | null
  tracking_number: string | null
  carrier: string | null
  estimated_delivery: string | null
  created_at: string
  updated_at: string
  stripe_client_secret?: string
  expires_at?: string | null
}
