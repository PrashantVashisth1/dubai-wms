'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, ClipboardList, FileClock, PackageCheck, Play, Plus, Trash2, Truck } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { SelectEmptyState } from '@/components/shared/SelectEmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { showApiError, showApiSuccess } from '@/lib/apiError';
import { DeskPage, Field } from './AdvancedInvoicingShell';
import toast from 'react-hot-toast';

function items(payload: any) {
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function total(payload: any) {
  return payload?.data?.total || payload?.data?.pagination?.total || items(payload).length;
}

export function PaymentEntriesPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [draftInvoices, setDraftInvoices] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  const [editingPaymentEntryId, setEditingPaymentEntryId] = useState<string | null>(null);
  const emptyEntryForm = { customerId: '', paidAmount: '', method: 'BANK_TRANSFER', reference: '', invoiceId: '', allocatedAmount: '' };
  const [form, setForm] = useState({
    customerId: '',
    paidAmount: '',
    method: 'BANK_TRANSFER',
    reference: '',
    invoiceId: '',
    allocatedAmount: '',
  });

  const load = async () => {
    setIsLoading(true);
    try {
      const [entryRes, invoiceRes, customerRes, draftRes] = await Promise.all([
        api.get('/payments/entries', { params: { limit: 200 } }),
        api.get('/invoices', { params: { limit: 500, status: 'OPEN' } }),
        api.get('/customers', { params: { limit: 200 } }),
        api.get('/invoices', { params: { limit: 50, status: 'DRAFT' } }),
      ]);
      setEntries(items(entryRes.data));
      const openInvoices = items(invoiceRes.data).filter(
        (invoice: any) => ['SUBMITTED', 'PARTIAL'].includes(invoice.status) && Number(invoice.outstandingAmount || 0) > 0
      );
      setInvoices(openInvoices);
      setCustomers(items(customerRes.data));
      setDraftInvoices(items(draftRes.data));
    } catch (err: any) {
      showApiError(err, 'Failed to load payment entries');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === form.invoiceId),
    [invoices, form.invoiceId]
  );
  // Only the selected customer's open invoices can be allocated.
  const allocatableInvoices = useMemo(
    () => (form.customerId ? invoices.filter((invoice) => invoice.customerId === form.customerId) : invoices),
    [invoices, form.customerId]
  );
  const customerDrafts = useMemo(
    () => draftInvoices.filter((invoice) => !form.customerId || invoice.customerId === form.customerId),
    [draftInvoices, form.customerId]
  );
  const selectedCustomer = customers.find((customer) => customer.id === form.customerId);
  const advancePreview = Math.max(0, Number(form.paidAmount || 0) - (form.invoiceId ? Number(form.allocatedAmount || 0) : 0));

  const create = async () => {
    if (isSubmitting) return;

    const paidNum = Number(form.paidAmount);
    if (!form.paidAmount || Number.isNaN(paidNum) || paidNum <= 0) {
      toast.error('Please enter a paid amount greater than zero');
      return;
    }

    const customerId = form.customerId || selectedInvoice?.customerId;
    if (!customerId) {
      toast.error('Please select a customer or an invoice');
      return;
    }

    setIsSubmitting(true);
    try {
      const allocatedAmount = Number(form.allocatedAmount || Math.min(paidNum, Number(selectedInvoice?.outstandingAmount || paidNum)));
      if (form.invoiceId && allocatedAmount > paidNum) {
        toast.error('Allocated amount cannot exceed the paid amount');
        setIsSubmitting(false);
        return;
      }
      const payload = {
        type: 'RECEIVED',
        customerId,
        paidAmount: paidNum,
        method: form.method,
        reference: form.reference,
        currency: selectedInvoice?.currency || selectedCustomer?.currency || undefined,
        allocations: form.invoiceId ? [{ invoiceId: form.invoiceId, allocatedAmount }] : [],
      };
      if (editingPaymentEntryId) await api.put(`/payments/entries/${editingPaymentEntryId}`, payload); else await api.post('/payments/entries', payload);
      showApiSuccess(`Payment entry ${editingPaymentEntryId ? 'updated' : 'drafted'}`);
      setOpen(false);
      setForm(emptyEntryForm);
      setEditingPaymentEntryId(null);
      load();
    } catch (err: any) {
      showApiError(err, 'Failed to create payment entry');
    } finally {
      setIsSubmitting(false);
    }
  };
  const editPaymentEntry = (entry: any) => { const allocation = entry.allocations?.[0] || {}; setEditingPaymentEntryId(entry.id); setForm({ customerId: entry.customerId || '', paidAmount: String(entry.paidAmount || ''), method: entry.method || 'BANK_TRANSFER', reference: entry.reference || '', invoiceId: allocation.invoiceId || '', allocatedAmount: allocation.allocatedAmount == null ? '' : String(allocation.allocatedAmount) }); setOpen(true); };

  const setStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/payments/entries/${id}/status`, { status });
      showApiSuccess(`Payment entry ${status.toLowerCase()}`);
      load();
    } catch (err: any) {
      showApiError(err, 'Failed to update payment entry');
    }
  };

  return (
    <DeskPage
      title="Payment Entries"
      description="Allocate one receipt across invoices or keep the balance as customer advance."
      action={
        <Button onClick={() => { setEditingPaymentEntryId(null); setForm(emptyEntryForm); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          New Entry
        </Button>
      }
    >
      {entries.length || isLoading ? (
        <DataTable
          data={entries}
          isLoading={isLoading}
          columns={[
            { key: 'paymentNo', header: 'Entry #' },
            { key: 'customer', header: 'Customer', render: (e: any) => e.customer?.name || '-' },
            { key: 'status', header: 'Status', render: (e: any) => <StatusBadge status={e.status} /> },
            { key: 'paidAmount', header: 'Paid', render: (e: any) => formatCurrency(e.paidAmount, e.currency) },
            { key: 'allocatedAmount', header: 'Allocated', render: (e: any) => formatCurrency(e.allocatedAmount, e.currency) },
            { key: 'unallocatedAmount', header: 'Advance', render: (e: any) => formatCurrency(e.unallocatedAmount, e.currency) },
            {
              key: 'allocations',
              header: 'Invoices',
              render: (e: any) => (e.allocations || []).map((a: any) => a.invoice?.invoiceNo).filter(Boolean).join(', ') || '-',
            },
            {
              key: 'actions',
              header: '',
              render: (e: any) => (
                <div className="flex justify-end gap-2">
                  {e.status === 'DRAFT' && (
                    <Button size="sm" variant="outline" onClick={() => editPaymentEntry(e)}>Edit</Button>
                  )}
                  {e.status === 'DRAFT' && (
                    <Button size="sm" onClick={() => setStatus(e.id, 'SUBMITTED')}>
                      Submit
                    </Button>
                  )}
                  {(e.status === 'SUBMITTED' || e.status === 'DRAFT') && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(e.id, 'CANCELLED')}>
                      Cancel
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No payment entries"
          description="Create a payment entry to allocate receipts across invoices."
          action={{ label: 'New Entry', onClick: () => { setEditingPaymentEntryId(null); setForm(emptyEntryForm); setOpen(true); } }}
        />
      )}

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setForm(emptyEntryForm); setEditingPaymentEntryId(null); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingPaymentEntryId ? 'Edit' : 'New'} Payment Entry</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Customer">
                <Select
                  value={form.customerId}
                  onValueChange={(value) => setForm((prev) => ({
                    ...prev,
                    customerId: value,
                    // Drop an allocation that belongs to another customer.
                    ...(invoices.find((invoice) => invoice.id === prev.invoiceId)?.customerId !== value ? { invoiceId: '', allocatedAmount: '' } : {}),
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.length === 0 ? (
                      <SelectEmptyState
                        message="No customers found"
                        linkHref="/customers"
                        linkText="Create Customer"
                      />
                    ) : (
                      customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Method">
                <Select
                  value={form.method}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, method: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE', 'ONLINE'].map((method) => (
                      <SelectItem key={method} value={method}>
                        {method.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Paid Amount *">
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.paidAmount}
                  onChange={(event) => setForm((prev) => ({ ...prev, paidAmount: event.target.value }))}
                />
              </Field>
              <Field label="Reference">
                <Input
                  value={form.reference}
                  placeholder="e.g. Bank Ref / Cheque No."
                  onChange={(event) => setForm((prev) => ({ ...prev, reference: event.target.value }))}
                />
              </Field>
            </div>
            <div className="rounded-md border border-[#dfe3e8] p-3">
              <div className="mb-3 text-sm font-medium text-[#1f2937]">Invoice Allocation</div>
              <div className="grid grid-cols-[1fr_180px] gap-3">
                <Select
                  value={form.invoiceId}
                  onValueChange={(value) => {
                    const invoice = invoices.find((i) => i.id === value);
                    setForm((prev) => ({
                      ...prev,
                      invoiceId: value,
                      customerId: invoice?.customerId || prev.customerId,
                      allocatedAmount: String(invoice?.outstandingAmount || ''),
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional invoice allocation" />
                  </SelectTrigger>
                  <SelectContent>
                    {allocatableInvoices.length === 0 ? (
                      <SelectEmptyState
                        message={form.customerId ? 'No submitted invoices with a balance for this customer' : 'No open invoices found'}
                        linkHref="/invoicing/sales-invoices"
                        linkText="View invoices"
                      />
                    ) : (
                      allocatableInvoices.map((invoice) => (
                        <SelectItem key={invoice.id} value={invoice.id}>
                          {invoice.invoiceNo} - {invoice.customer?.name} -{' '}
                          {formatCurrency(invoice.outstandingAmount, invoice.currency)} due
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  value={form.allocatedAmount}
                  onChange={(event) => setForm((prev) => ({ ...prev, allocatedAmount: event.target.value }))}
                  placeholder="Allocated amount"
                />
              </div>
              {form.invoiceId && (
                <button type="button" className="mt-2 text-xs text-[#1674c4] hover:underline" onClick={() => setForm((prev) => ({ ...prev, invoiceId: '', allocatedAmount: '' }))}>
                  Remove allocation (keep the full receipt as an advance)
                </button>
              )}
              {Number(form.paidAmount || 0) > 0 && (
                <p className="mt-2 text-xs text-[#6b7280]">
                  Unallocated amount posted to Customer Advances on submit: {formatCurrency(advancePreview, selectedInvoice?.currency || selectedCustomer?.currency || 'USD')}
                </p>
              )}
              {customerDrafts.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>Draft invoices cannot be allocated. Submit invoice first:</span>
                  {customerDrafts.slice(0, 5).map((draft) => (
                    <Link key={draft.id} href={`/invoicing/sales-invoices/${draft.id}`} className="inline-flex items-center gap-0.5 font-semibold underline">
                      {draft.invoiceNo} <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : editingPaymentEntryId ? 'Update Draft' : 'Create Draft'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DeskPage>
  );
}

export function DeliveryNotesPage() {
  const [notes, setNotes] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingDeliveryId, setEditingDeliveryId] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerId: '',
    salesOrderId: '',
    warehouseId: '',
    date: new Date().toISOString().slice(0, 10),
    postingDate: '',
    notes: '',
  });
  const [deliveryRows, setDeliveryRows] = useState<any[]>([{ productId: '', description: '', quantity: 1 }]);
  const [totalRows, setTotalRows] = useState(0);

  const load = async () => {
    setIsLoading(true);
    try {
      const [noteRes, customerRes, orderRes, warehouseRes, productRes] = await Promise.all([
        api.get('/delivery-notes'),
        api.get('/customers', { params: { limit: 200, isActive: true } }),
        api.get('/sales/orders', { params: { limit: 200 } }),
        api.get('/inventory/warehouses'),
        api.get('/inventory/products', { params: { limit: 200, isActive: true } }),
      ]);
      setNotes(items(noteRes.data));
      setTotalRows(total(noteRes.data));
      setCustomers(items(customerRes.data));
      setOrders(items(orderRes.data).filter((order: any) => !['DRAFT', 'CANCELLED', 'CLOSED'].includes(order.status)));
      setWarehouses(items(warehouseRes.data));
      setProducts(items(productRes.data).filter((product: any) => product.type !== 'SERVICE'));
    } catch (err: any) {
      showApiError(err, 'Failed to load delivery notes');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    try {
      await api.patch(`/delivery-notes/${id}/status`, { status });
      showApiSuccess(`Delivery note ${status.toLowerCase()}`);
      load();
    } catch (err: any) {
      showApiError(err, 'Failed to update delivery note');
    }
  };

  const createInvoice = async (id: string) => {
    try {
      const res = await api.post(`/invoices/from-delivery-note/${id}`);
      const invoice = res.data?.data;
      showApiSuccess(`Draft invoice ${invoice?.invoiceNo || ''} created from delivery note`);
      if (invoice?.id) window.location.href = `/invoicing/sales-invoices/${invoice.id}`;
    } catch (err: any) {
      showApiError(err, 'Failed to create invoice');
    }
  };

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === form.salesOrderId),
    [orders, form.salesOrderId]
  );

  const createFromOrder = async () => {
    if (!form.salesOrderId) return toast.error('Select a sales order');
    try {
      await api.post(`/delivery-notes/from-sales-order/${form.salesOrderId}`);
      showApiSuccess('Draft delivery note created from sales order');
      setOpen(false);
      resetDeliveryForm();
      load();
    } catch (err: any) {
      showApiError(err, 'Failed to create delivery note');
    }
  };

  const createManual = async () => {
    if (!form.customerId) return toast.error('Select a customer');
    const rows = deliveryRows.filter((row) => row.productId && Number(row.quantity) > 0);
    if (!rows.length) return toast.error('Add at least one product to deliver');
    try {
      const payload = {
        ...form,
        salesOrderId: form.salesOrderId || undefined,
        warehouseId: form.warehouseId || undefined,
        postingDate: form.postingDate || undefined,
        items: rows,
      };
      if (editingDeliveryId) await api.put(`/delivery-notes/${editingDeliveryId}`, payload); else await api.post('/delivery-notes', payload);
      showApiSuccess(`Draft delivery note ${editingDeliveryId ? 'updated' : 'created'}`);
      setOpen(false);
      resetDeliveryForm();
      setEditingDeliveryId(null);
      load();
    } catch (err: any) {
      showApiError(err, 'Failed to create delivery note');
    }
  };
  const editDelivery = (note: any) => { setEditingDeliveryId(note.id); setForm({ customerId: note.customerId || '', salesOrderId: note.salesOrderId || '', warehouseId: note.warehouseId || '', date: String(note.date).slice(0, 10), postingDate: note.postingDate ? String(note.postingDate).slice(0, 10) : '', notes: note.notes || '' }); setDeliveryRows((note.items || []).map((i: any) => ({ productId: i.productId, description: i.description || '', quantity: Number(i.quantity) }))); setOpen(true); };

  const resetDeliveryForm = () => {
    setForm({
      customerId: '',
      salesOrderId: '',
      warehouseId: '',
      date: new Date().toISOString().slice(0, 10),
      postingDate: '',
      notes: '',
    });
    setDeliveryRows([{ productId: '', description: '', quantity: 1 }]);
  };

  return (
    <DeskPage
      title="Delivery Notes"
      description="Draft the shipment, submit when goods leave stock, then invoice from the delivered document."
      meta={`${totalRows} records`}
      action={
        <Button onClick={() => { setEditingDeliveryId(null); resetDeliveryForm(); setOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          New Delivery Note
        </Button>
      }
    >
      {notes.length || isLoading ? (
        <DataTable
          data={notes}
          isLoading={isLoading}
          columns={[
            { key: 'deliveryNo', header: 'Delivery #' },
            { key: 'customer', header: 'Customer', render: (n: any) => n.customer?.name || '-' },
            { key: 'salesOrder', header: 'Sales Order', render: (n: any) => n.salesOrder?.orderNo || '-' },
            { key: 'warehouse', header: 'Warehouse', render: (n: any) => n.warehouse?.name || '-' },
            { key: 'date', header: 'Date', render: (n: any) => formatDate(n.date) },
            { key: 'status', header: 'Status', render: (n: any) => <StatusBadge status={n.status} /> },
            { key: 'items', header: 'Items', render: (n: any) => n.items?.length || 0 },
            {
              key: 'invoice',
              header: 'Invoice',
              render: (n: any) => (n.invoiceId ? <Link className="text-[#1674c4] hover:underline" href={`/invoicing/sales-invoices/${n.invoiceId}`}>{n.invoiceNo}</Link> : '-'),
            },
            {
              key: 'actions',
              header: '',
              render: (n: any) => (
                <div className="flex justify-end gap-2">
                  {n.status === 'DRAFT' && (
                    <Button size="sm" variant="outline" onClick={() => editDelivery(n)}>Edit</Button>
                  )}
                  {n.status === 'DRAFT' && (
                    <Button size="sm" onClick={() => setStatus(n.id, 'SUBMITTED')}>
                      Submit
                    </Button>
                  )}
                  {n.status === 'SUBMITTED' && (
                    <Button size="sm" onClick={() => createInvoice(n.id)}>
                      Invoice
                    </Button>
                  )}
                  {(n.status === 'SUBMITTED' || n.status === 'DRAFT') && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(n.id, 'CANCELLED')}>
                      Cancel
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <EmptyState
          icon={PackageCheck}
          title="No delivery notes"
          description="Create delivery notes from confirmed sales orders or enter a manual shipment."
          action={{ label: 'New Delivery Note', onClick: () => { setEditingDeliveryId(null); resetDeliveryForm(); setOpen(true); } }}
        />
      )}

      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { resetDeliveryForm(); setEditingDeliveryId(null); } }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingDeliveryId ? 'Edit' : 'New'} Delivery Note</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="rounded-md border border-[#e5e2dc] bg-[#f8faf9] p-3 text-sm text-[#4b5563]">
              Delivery Notes are stock documents. Create from a Sales Order when possible; use manual rows for direct shipment adjustments.
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Get from Sales Order">
                <Select
                  value={form.salesOrderId}
                  onValueChange={(value) => {
                    const order = orders.find((o) => o.id === value);
                    setForm((prev) => ({
                      ...prev,
                      salesOrderId: value,
                      customerId: order?.customerId || prev.customerId,
                    }));
                    if (order?.items?.length) {
                      setDeliveryRows(
                        order.items.map((item: any) => ({
                          productId: item.productId,
                          description: item.description || item.product?.name || '',
                          quantity: Number(item.quantity || 1),
                        }))
                      );
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Optional source order" />
                  </SelectTrigger>
                  <SelectContent>
                    {orders.length === 0 ? (
                      <SelectEmptyState
                        message="No sales orders found"
                        linkHref="/sales/orders"
                        linkText="Create Sales Order"
                      />
                    ) : (
                      orders.map((order) => (
                        <SelectItem key={order.id} value={order.id}>
                          {order.orderNo} · {order.customer?.name || 'Customer'} · {order.status}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Customer">
                <Select
                  value={form.customerId}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, customerId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.length === 0 ? (
                      <SelectEmptyState
                        message="No customers found"
                        linkHref="/customers"
                        linkText="Create Customer"
                      />
                    ) : (
                      customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Warehouse">
                <Select
                  value={form.warehouseId}
                  onValueChange={(value) => setForm((prev) => ({ ...prev, warehouseId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Default active warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.length === 0 ? (
                      <SelectEmptyState
                        message="No warehouses found"
                        linkHref="/inventory/warehouses"
                        linkText="Create Warehouse"
                      />
                    ) : (
                      warehouses.map((warehouse) => (
                        <SelectItem key={warehouse.id} value={warehouse.id}>
                          {warehouse.code ? `${warehouse.code} - ` : ''}
                          {warehouse.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Date">
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                />
              </Field>
              <Field label="Posting Date">
                <Input
                  type="date"
                  value={form.postingDate}
                  onChange={(event) => setForm((prev) => ({ ...prev, postingDate: event.target.value }))}
                />
              </Field>
              <Field label="Notes">
                <Input
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Transporter, LR number, delivery remarks"
                />
              </Field>
            </div>

            {selectedOrder && (
              <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Source {selectedOrder.orderNo}: {selectedOrder.items?.length || 0} item(s) will be copied into the draft delivery note.
              </div>
            )}

            <DeliveryRows rows={deliveryRows} products={products} onChange={setDeliveryRows} />

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              {form.salesOrderId && !editingDeliveryId && (
                <Button variant="outline" onClick={createFromOrder}>
                  <Truck className="mr-2 h-4 w-4" />
                  Create from Sales Order
                </Button>
              )}
              <Button onClick={createManual}>{editingDeliveryId ? 'Update Draft' : 'Create Manual Draft'}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DeskPage>
  );
}

function DeliveryRows({ rows, products, onChange }: { rows: any[]; products: any[]; onChange: (rows: any[]) => void }) {
  const update = (index: number, patch: any) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const add = () => onChange([...rows, { productId: '', description: '', quantity: 1 }]);
  const remove = (index: number) => onChange(rows.length === 1 ? rows : rows.filter((_, i) => i !== index));

  return (
    <div className="rounded-md border border-[#e5e2dc] bg-white">
      <div className="grid grid-cols-[2fr_2fr_120px_48px] border-b border-[#e5e2dc] bg-[#f8faf9] px-3 py-2 text-xs font-semibold uppercase text-[#6b7280]">
        <span>Product</span>
        <span>Description</span>
        <span>Qty</span>
        <span />
      </div>
      <div className="divide-y divide-[#f0ede8]">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[2fr_2fr_120px_48px] gap-2 px-3 py-2">
            <Select
              value={row.productId}
              onValueChange={(value) => {
                const product = products.find((p) => p.id === value);
                update(index, {
                  productId: value,
                  description: row.description || product?.name || '',
                  itemCode: product?.sku || '',
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select product" />
              </SelectTrigger>
              <SelectContent>
                {products.length === 0 ? (
                  <SelectEmptyState
                    message="No products found"
                    linkHref="/inventory/products"
                    linkText="Create Product"
                  />
                ) : (
                  products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Input
              value={row.description || ''}
              onChange={(event) => update(index, { description: event.target.value })}
            />
            <Input
              type="number"
              min="0.000001"
              step="0.000001"
              value={row.quantity}
              onChange={(event) => update(index, { quantity: Number(event.target.value) })}
            />
            <Button variant="ghost" size="icon" onClick={() => remove(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="border-t border-[#e5e2dc] p-2">
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="mr-2 h-4 w-4" />
          Add Row
        </Button>
      </div>
    </div>
  );
}

export function AuditLogPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [filters, setFilters] = useState({ entityType: 'ALL', action: 'ALL', search: '', fromDate: '', toDate: '' });

  const load = () => {
    api
      .get('/invoicing/audit-logs', {
        params: {
          limit: 200,
          entityType: filters.entityType === 'ALL' ? undefined : filters.entityType,
          action: filters.action === 'ALL' ? undefined : filters.action,
          search: filters.search || undefined,
          fromDate: filters.fromDate || undefined,
          toDate: filters.toDate || undefined,
        },
      })
      .then((res) => {
        setLogs(items(res.data));
        setTotalRows(total(res.data));
      })
      .catch((err) => showApiError(err, 'Failed to load audit log'));
  };

  useEffect(() => {
    load();
    // Date filters apply immediately; the text search applies on Enter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.entityType, filters.action, filters.fromDate, filters.toDate]);

  return (
    <DeskPage
      title="Audit Log"
      description="Immutable document timeline for invoice lifecycle, delivery, credit note, and payment actions."
      meta={`${totalRows} events`}
      action={
        <Button variant="outline" onClick={load}>
          Refresh
        </Button>
      }
    >
      <div className="grid gap-3 border-b border-[#edf0f2] bg-[#f8faf9] p-3 md:grid-cols-5">
        <Input
          value={filters.search}
          onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') load();
          }}
          placeholder="Search message or actor"
        />
        <Select
          value={filters.entityType}
          onValueChange={(entityType) => setFilters((prev) => ({ ...prev, entityType }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['ALL', 'SALES_INVOICE', 'PAYMENT', 'PAYMENT_ENTRY', 'CREDIT_NOTE', 'DELIVERY_NOTE', 'TAX_TEMPLATE', 'PRINT_FORMAT', 'SUBSCRIPTION', 'SHIPPING_INVOICE', 'COMPANY_PROFILE'].map((type) => (
              <SelectItem key={type} value={type}>
                {type.replaceAll('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.action} onValueChange={(action) => setFilters((prev) => ({ ...prev, action }))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              'ALL',
              'CREATE',
              'UPDATE',
              'SUBMIT',
              'CANCEL',
              'AMEND',
              'DELETE',
              'PAYMENT',
              'PAUSE',
              'RESUME',
              'RUN_DUE',
              'CREATE_FROM_SALES_ORDER',
              'CREATE_FROM_DELIVERY_NOTE',
              'CREATE_FROM_SUBSCRIPTION',
            ].map((action) => (
              <SelectItem key={action} value={action}>
                {action.replaceAll('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={filters.fromDate}
          onChange={(event) => setFilters((prev) => ({ ...prev, fromDate: event.target.value }))}
        />
        <Input
          type="date"
          value={filters.toDate}
          onChange={(event) => setFilters((prev) => ({ ...prev, toDate: event.target.value }))}
        />
      </div>
      {logs.length ? (
        <DataTable
          data={logs}
          columns={[
            { key: 'createdAt', header: 'Time', render: (l: any) => formatDateTime(l.createdAt) },
            { key: 'entityType', header: 'Document' },
            {
              key: 'voucher',
              header: 'Voucher',
              render: (l: any) =>
                l.voucher || l.invoice?.invoiceNo || l.deliveryNote?.deliveryNo || l.creditNote?.creditNoteNo || l.entityId,
            },
            { key: 'action', header: 'Action', render: (l: any) => <StatusBadge status={l.action} /> },
            { key: 'statusBefore', header: 'Before', render: (l: any) => l.statusBefore || '-' },
            { key: 'statusAfter', header: 'After', render: (l: any) => l.statusAfter || '-' },
            { key: 'actorEmail', header: 'User', render: (l: any) => l.actorEmail || l.actorRole || '-' },
            { key: 'message', header: 'Message', render: (l: any) => l.message || '-' },
          ]}
        />
      ) : (
        <EmptyState
          icon={FileClock}
          title="No audit events"
          description="Document actions will appear here as users work."
        />
      )}
    </DeskPage>
  );
}

export function RecurringRunnerButton({ onDone }: { onDone?: () => void }) {
  const run = async () => {
    try {
      const res = await api.post('/invoicing/subscriptions/run-due');
      showApiSuccess(res.data?.message || 'Recurring invoices generated');
      onDone?.();
    } catch (err: any) {
      showApiError(err, 'Failed to run recurring invoices');
    }
  };
  return (
    <Button variant="outline" onClick={run}>
      <Play className="mr-2 h-4 w-4" />
      Run Due Now
    </Button>
  );
}
