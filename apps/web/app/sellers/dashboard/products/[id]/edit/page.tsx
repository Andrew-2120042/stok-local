import ProductForm from '../../ProductForm'

export default function EditProductPage({ params }: { params: { id: string } }) {
  return <ProductForm productId={params.id} />
}
