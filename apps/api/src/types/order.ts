import { z } from 'zod'
import type { OrderStatus } from '@stok/types'

// Address is optional at order creation (it can be completed later via
// PATCH /v1/order/:id/details before payment), so only the minimal identifying
// fields are required; state/postal_code may be supplied at checkout.
export const ShippingAddressSchema = z.object({
  full_name: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1).optional(),
  postal_code: z.string().min(1).optional(),
  country: z.string().default('IN'),
  phone: z.string().optional(),
})

export const CreateOrderSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10).default(1),
  // Cap length — session_id participates in the (session_id, product_id) unique
  // index, so an unbounded value risks a btree row-size error.
  session_id: z.string().max(255).optional(),
  shipping_address: ShippingAddressSchema.optional(),
})

export const UpdateOrderDetailsSchema = z.object({
  buyer_email: z.string().email().optional(),
  shipping_address: ShippingAddressSchema.optional(),
})

export interface ProductForOrder {
  id: string
  seller_id: string
  name: string
  brand: string
  category: string
  price: number
  currency: string
  images: string[]
  availability: string
  stock: number
  specs: Record<string, unknown>
  is_sandbox: boolean
  seller_name: string
  seller_email: string
  seller_trust_score: number
  seller_stripe_account_id: string | null
}

export interface OrderWithDetails {
  id: string
  session_id: string
  product_id: string
  seller_id: string
  developer_id: string | null
  quantity: number
  unit_price: number
  total_price: number
  currency: string
  status: OrderStatus
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
  product_name: string
  product_image: string | null
  product_brand: string
  product_quality_score: number
  seller_name: string
  seller_email: string
  seller_trust_score: number
}

export interface CreateOrderData {
  session_id: string
  product_id: string
  seller_id: string
  developer_id?: string
  quantity: number
  unit_price: number
  total_price: number
  currency: string
  status: string
  stripe_payment_intent_id: string
  shipping_address: Record<string, string | undefined> | null
  expires_at: Date
  buyer_email?: string
  is_sandbox?: boolean
}

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
    quality_score: number
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
