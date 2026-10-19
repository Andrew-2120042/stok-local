export type SellerStatus = 'active' | 'suspended' | 'pending'

export interface Seller {
  id: string
  name: string
  email: string
  stripe_account_id: string | null
  stripe_onboarding_complete: boolean
  trust_score: number
  fulfillment_rate: number
  dispute_rate: number
  avg_delivery_days: number
  status: SellerStatus
  supabase_user_id: string | null
  business_type: string | null
  gst_number: string | null
  phone: string | null
  address: Record<string, string> | null
  logo_url: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export type ProductAvailability = 'in_stock' | 'out_of_stock' | 'discontinued'

export interface Product {
  id: string
  seller_id: string
  name: string
  brand: string
  category: string
  description: string
  specs: Record<string, string | number>
  images: string[]
  price: number
  currency: string
  stock: number
  availability: ProductAvailability
  embedding: number[] | null
  is_sandbox: boolean
  product_quality_score: number
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type DeveloperPlan = 'free' | 'starter' | 'pro' | 'enterprise'

export interface Developer {
  id: string
  email: string
  name: string
  plan: DeveloperPlan
  supabase_user_id: string | null
  created_at: string
}

export interface ApiKey {
  id: string
  developer_id: string
  key_hash: string
  key_prefix: string
  name: string
  last_used_at: string | null
  is_sandbox: boolean
  created_at: string
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'

export interface Order {
  id: string
  developer_id: string | null
  session_id: string
  product_id: string
  seller_id: string
  quantity: number
  unit_price: number
  total_price: number
  currency: string
  status: OrderStatus
  checkout_url: string | null
  stripe_payment_intent_id: string | null
  shipping_address: Record<string, string> | null
  tracking_number: string | null
  carrier: string | null
  estimated_delivery: string | null
  expires_at: string | null
  buyer_email: string | null
  is_sandbox: boolean
  created_at: string
  updated_at: string
}

export interface OrderEvent {
  id: string
  order_id: string
  event_type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface Webhook {
  id: string
  developer_id: string
  url: string
  events: string[]
  secret: string
  is_active: boolean
  created_at: string
}

export interface Search {
  id: string
  developer_id: string | null
  session_id: string | null
  query: string
  result_count: number | null
  top_result_id: string | null
  latency_ms: number | null
  created_at: string
}
