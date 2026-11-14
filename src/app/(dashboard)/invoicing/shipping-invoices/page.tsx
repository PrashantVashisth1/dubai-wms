'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download, FileText, Plus, Search, Ship, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pagination } from '@/components/shared/Pagination';
import api from '@/lib/api';
import { showApiError, showApiSuccess } from '@/lib/apiError';
import { formatDate } from '@/lib/utils';
import { formatCbm, formatCurrencyValue, formatQuantity } from '@/lib/shipping/shippingInvoice';
import { openShippingPdf } from '@/components/invoicing/shipping/shippingApi';

type Row = {
  id: string; invoiceRefNo: string; date: string; currency: string; packageType: string; transactionType: string;
  shipTo?: { companyName?: string }; fromLocation?: string; toCountry?: string;
  totals?: { qty: number; value: number; weightKg: number; packages: number; cbm: number };
};

export default function ShippingInvoicesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const limit = 20;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      api.get('/invoicing/shipping-invoices', { params: { page, limit, search: search || undefined } })
        .then(res => { setRows(res.data?.data?.items || []); setTotal(res.data?.data?.total || 0); })
        .catch(err => showApiError(err, 'Failed to load shipping invoices'))
        .finally(() => setIsLoading(false));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [page, search, reloadKey]);

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.delete(`/invoicing/shipping-invoices/${toDelete.id}`);
      showApiSuccess(`Shipping invoice ${toDelete.invoiceRefNo} deleted`);
      setToDelete(null);
      setReloadKey(key => key + 1);
    } catch (err) {
      showApiError(err, 'Failed to delete shipping invoice');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1f2937]">Shipping Invoices</h1>
          <p className="text-sm text-[#6b7280]">Delivery Advice, Invoice / Packing List and Commodity Classification in one 3-page PDF.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/invoicing/company-profile">Company Profile</Link></Button>
          <Button asChild><Link href="/invoicing/shipping-invoices/new"><Plus className="mr-2 h-4 w-4" />New Shipping Invoice</Link></Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa3af]" />
        <Input className="pl-8" value={search} placeholder="Search ref no., consignee, shipper..." onChange={event => { setSearch(event.target.value); setPage(1); }} />
      </div>

      {!isLoading && rows.length === 0 ? (
        <EmptyState icon={Ship} title={search ? 'No matching shipping invoices' : 'No shipping invoices yet'}
          description="Create one from scratch, or open a sales invoice and choose “Shipping Invoice”."
          action={{ label: 'New Shipping Invoice', onClick: () => { window.location.href = '/invoicing/shipping-invoices/new'; } }} />
      ) : (
        <>
          <DataTable
            data={rows}
            isLoading={isLoading}
            onRowClick={(row: Row) => { window.location.href = `/invoicing/shipping-invoices/${row.id}`; }}
            columns={[
              { key: 'invoiceRefNo', header: 'Invoice / Ref No.', render: (row: Row) => <span className="font-medium text-[#1674c4]">{row.invoiceRefNo}</span> },
              { key: 'date', header: 'Date', render: (row: Row) => formatDate(row.date) },
              { key: 'shipTo', header: 'Ship To', render: (row: Row) => row.shipTo?.companyName || '-' },
              { key: 'route', header: 'Route', render: (row: Row) => `${row.fromLocation || '-'} → ${row.toCountry || '-'}` },
              { key: 'transactionType', header: 'Type' },
              { key: 'packages', header: 'Packages', render: (row: Row) => `${formatQuantity(row.totals?.packages || 0)} ${row.packageType}` },
              { key: 'cbm', header: 'CBM', render: (row: Row) => formatCbm(row.totals?.cbm || 0, 2) },
              { key: 'value', header: 'Value', render: (row: Row) => <span className="font-semibold">{formatCurrencyValue(row.currency, row.totals?.value || 0)}</span> },
              {
                key: 'actions', header: '', render: (row: Row) => (
                  <div className="flex justify-end gap-1" onClick={event => event.stopPropagation()}>
                    <Button size="sm" variant="outline" onClick={() => openShippingPdf(row.id, row.invoiceRefNo, 'open')}><FileText className="mr-1 h-3.5 w-3.5" />PDF</Button>
                    <Button size="sm" variant="outline" onClick={() => openShippingPdf(row.id, row.invoiceRefNo, 'download')}><Download className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setToDelete(row)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ),
              },
            ]}
          />
          {total > limit && <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} limit={limit} onPageChange={setPage} />}
        </>
      )}

      <Dialog open={!!toDelete} onOpenChange={open => { if (!open) setToDelete(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete shipping invoice {toDelete?.invoiceRefNo}?</DialogTitle></DialogHeader>
          <p className="text-sm text-[#6b7280]">The document is removed permanently. The deletion is recorded in the invoice audit log.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setToDelete(null)}>Keep</Button>
            <Button variant="destructive" onClick={remove}>Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
