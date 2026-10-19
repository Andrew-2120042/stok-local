import OrderDetailClient from './OrderDetailClient'

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  return <OrderDetailClient id={params.id} />
}
