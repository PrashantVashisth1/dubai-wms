// Plain ESM (no TypeScript syntax) so both the Next.js API and the
// `scripts/invoicing-db.mjs` CLI share one collection/index definition.

/** Collection names used by the invoicing backend and its dependencies. */
export const C = Object.freeze({
  customers: 'customers',
  products: 'products',
  warehouses: 'warehouses',
  salesOrders: 'sales_orders',
  invoices: 'invoices',
  payments: 'payments',
  paymentEntries: 'payment_entries',
  creditNotes: 'credit_notes',
  deliveryNotes: 'delivery_notes',
  taxTemplates: 'tax_templates',
  printFormats: 'print_formats',
  ledger: 'ledger_entries',
  subscriptions: 'subscriptions',
  auditLogs: 'invoice_audit_logs',
  counters: 'counters',
  shippingInvoices: 'shipping_invoices',
  companySettings: 'company_settings',
});

/**
 * Index plan. Unique indexes are the last line of defence against duplicate
 * document numbers and duplicate conversions (delivery note -> invoice,
 * subscription run -> invoice) under concurrency.
 */
/** @type {Record<string, import('mongodb').IndexDescription[]>} */
export const INDEXES = {
  [C.customers]: [
    { key: { customerNo: 1 }, unique: true, name: 'uniq_customerNo' },
    { key: { name: 1 }, name: 'name' },
    { key: { isActive: 1, createdAt: -1 }, name: 'active_recent' },
  ],
  [C.products]: [
    { key: { sku: 1 }, unique: true, name: 'uniq_sku' },
    { key: { isActive: 1, name: 1 }, name: 'active_name' },
  ],
  [C.warehouses]: [
    { key: { code: 1 }, unique: true, name: 'uniq_code', partialFilterExpression: { code: { $type: 'string' } } },
  ],
  [C.salesOrders]: [
    { key: { orderNo: 1 }, unique: true, name: 'uniq_orderNo' },
    { key: { customerId: 1, date: -1 }, name: 'customer_date' },
    { key: { status: 1 }, name: 'status' },
  ],
  [C.invoices]: [
    { key: { invoiceNo: 1 }, unique: true, name: 'uniq_invoiceNo' },
    { key: { status: 1, date: -1 }, name: 'status_date' },
    { key: { customerId: 1, status: 1 }, name: 'customer_status' },
    { key: { dueDate: 1, outstandingAmount: 1 }, name: 'due_outstanding' },
    { key: { createdAt: -1 }, name: 'recent' },
    // One active invoice per delivery note / subscription run / amendment source.
    // `deliveryNoteLock` is removed when the invoice is cancelled, freeing the note.
    { key: { deliveryNoteLock: 1 }, unique: true, name: 'uniq_deliveryNoteLock', partialFilterExpression: { deliveryNoteLock: { $type: 'string' } } },
    { key: { salesOrderLock: 1 }, unique: true, name: 'uniq_salesOrderLock', partialFilterExpression: { salesOrderLock: { $type: 'string' } } },
    { key: { subscriptionRunKey: 1 }, unique: true, name: 'uniq_subscriptionRunKey', partialFilterExpression: { subscriptionRunKey: { $type: 'string' } } },
    { key: { amendedFromId: 1 }, unique: true, name: 'uniq_amendedFromId', partialFilterExpression: { amendedFromId: { $type: 'string' } } },
  ],
  [C.payments]: [
    { key: { paymentNo: 1 }, unique: true, name: 'uniq_paymentNo' },
    { key: { invoiceId: 1, status: 1 }, name: 'invoice_status' },
    { key: { customerId: 1, date: -1 }, name: 'customer_date' },
    { key: { createdAt: -1 }, name: 'recent' },
  ],
  [C.paymentEntries]: [
    { key: { paymentNo: 1 }, unique: true, name: 'uniq_paymentNo' },
    { key: { 'allocations.invoiceId': 1, status: 1 }, name: 'allocation_invoice' },
    { key: { customerId: 1, createdAt: -1 }, name: 'customer_recent' },
  ],
  [C.creditNotes]: [
    { key: { creditNoteNo: 1 }, unique: true, name: 'uniq_creditNoteNo' },
    { key: { originalInvoiceId: 1, status: 1 }, name: 'invoice_status' },
    { key: { createdAt: -1 }, name: 'recent' },
  ],
  [C.deliveryNotes]: [
    { key: { deliveryNo: 1 }, unique: true, name: 'uniq_deliveryNo' },
    { key: { salesOrderId: 1 }, name: 'salesOrder' },
    { key: { status: 1, createdAt: -1 }, name: 'status_recent' },
  ],
  [C.taxTemplates]: [
    { key: { code: 1 }, unique: true, name: 'uniq_code' },
  ],
  [C.printFormats]: [
    { key: { docType: 1, name: 1 }, unique: true, name: 'uniq_docType_name' },
    { key: { docType: 1, isDefault: 1, isActive: 1 }, name: 'default_lookup' },
  ],
  [C.ledger]: [
    { key: { postingDate: -1, createdAt: -1 }, name: 'posting' },
    { key: { voucherType: 1, voucherNo: 1 }, name: 'voucher' },
    { key: { entityId: 1 }, name: 'entity' },
    { key: { 'account.code': 1, postingDate: -1 }, name: 'account_posting' },
  ],
  [C.subscriptions]: [
    { key: { isActive: 1, nextRunDate: 1 }, name: 'due_lookup' },
    { key: { customerId: 1 }, name: 'customer' },
  ],
  [C.shippingInvoices]: [
    { key: { invoiceRefNo: 1 }, unique: true, name: 'uniq_invoiceRefNo' },
    { key: { date: -1, createdAt: -1 }, name: 'recent' },
    { key: { salesInvoiceId: 1 }, name: 'salesInvoice', partialFilterExpression: { salesInvoiceId: { $type: 'string' } } },
  ],
  [C.auditLogs]: [
    { key: { createdAt: -1 }, name: 'recent' },
    { key: { entityType: 1, action: 1, createdAt: -1 }, name: 'type_action' },
    { key: { entityId: 1, createdAt: -1 }, name: 'entity' },
  ],
};

/** @param {import('mongodb').Db} db */
export async function ensureInvoicingIndexes(db) {
  await Promise.all(
    Object.entries(INDEXES).map(([name, indexes]) => db.collection(name).createIndexes(indexes)),
  );
}
