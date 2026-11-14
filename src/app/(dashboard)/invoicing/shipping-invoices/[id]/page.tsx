'use client';

import { useParams } from 'next/navigation';
import { ShippingInvoiceEditor } from '@/components/invoicing/shipping/ShippingInvoiceEditor';

export default function ShippingInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  return <ShippingInvoiceEditor id={params.id} />;
}
