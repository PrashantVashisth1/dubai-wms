import type { Db } from 'mongodb';
import { DatabaseUnavailableError, getDb, supportsTransactions } from './server/mongo';
import { HttpError, actorFrom, notFound, toApi, type Actor, type Doc } from './server/invoicing/core';
import { C } from './server/invoicing/indexes.mjs';
import {
  amendInvoice, changeInvoiceStatus, createInvoice, customerOutstanding, invoiceDetail, listInvoices, updateDraftInvoice,
} from './server/invoicing/invoices';
import {
  deliveryFromSalesOrder, getDeliveryNote, getSalesOrder, invoiceFromDeliveryNote, invoiceFromSalesOrder, listCustomers, listDeliveryNotes,
  listPrintFormats, listProducts, listSalesOrders, listSubscriptions, listTaxTemplates, listWarehouses, runDueSubscriptions, saveCustomer,
  saveDeliveryNote, savePrintFormat, saveProduct, saveSalesOrder, saveSubscription, saveTaxTemplate, saveWarehouse, setDeliveryStatus,
  setSalesOrderStatus, softDelete,
} from './server/invoicing/operations';
import { renderInvoicePdf } from './server/invoicing/pdf';
import {
  deleteShippingInvoice, getCompanyProfile, getShippingInvoice, listShippingInvoices, prefillFromSalesInvoice, saveCompanyProfile,
  saveShippingInvoice, shippingInvoicePdf,
} from './server/invoicing/shipping';
import { agingReport, listAuditLogs, listLedger, outstandingReport, revenueByItemReport, revenueReport } from './server/invoicing/reports';
import {
  cancelPayment, changeCreditNoteStatus, changePaymentEntryStatus, getCreditNote, getPayment, getPaymentEntry, listCreditNotes,
  listPaymentEntries, listPayments, recordPayment, saveDraftCreditNote, saveDraftPaymentEntry,
} from './server/invoicing/settlements';

/**
 * REST backend for the Invoicing module (and the master data it depends on),
 * served from /api/v1/[...path]. Persistence is MongoDB only; if the database
 * is unreachable every call fails with 503 instead of pretending to save.
 */

type Ctx = { db: Db; url: URL; body: Doc; actor: Actor; params: string[]; request: Request };
type Handler = (ctx: Ctx) => Promise<unknown>;
type Route = { method: string; pattern: RegExp; handler: Handler; raw?: boolean };

const ok = (data: unknown, status = 200) => Response.json({ success: true, data }, { status });

const routes: Route[] = [];
const on = (method: string, path: string, handler: Handler, raw = false) => {
  const pattern = new RegExp(`^${path.replace(/:[a-zA-Z]+/g, '([^/]+)')}$`);
  routes.push({ method, pattern, handler, raw });
};

/* Invoices ----------------------------------------------------------------- */
on('GET', 'invoices/filter-options', async ({ db }) => ({ users: [], tags: await db.collection(C.invoices).distinct('tags') }));
on('GET', 'invoices', ({ db, url }) => listInvoices(db, url));
on('GET', 'invoicing/sales-invoices', ({ db, url }) => listInvoices(db, url));
on('POST', 'invoices', ({ db, actor, body }) => createInvoice(db, actor, body));
on('POST', 'invoicing/sales-invoices', ({ db, actor, body }) => createInvoice(db, actor, body));
on('POST', 'invoices/from-delivery-note/:id', ({ db, actor, params }) => invoiceFromDeliveryNote(db, actor, params[0]));
on('POST', 'invoices/from-sales-order/:id', ({ db, actor, params }) => invoiceFromSalesOrder(db, actor, params[0]));
on('GET', 'invoices/aging-report', ({ db, url }) => agingReport(db, url), true);
on('GET', 'invoices/:id/pdf', async ({ db, url, params }) => {
  const { bytes, filename, format } = await renderInvoicePdf(db, params[0], url.searchParams.get('printFormatId'));
  const disposition = url.searchParams.get('download') === 'true' ? 'attachment' : 'inline';
  return new Response(new Uint8Array(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Print-Format': encodeURIComponent(format) },
  });
}, true);
on('PATCH', 'invoices/:id/status', ({ db, actor, params, body }) => changeInvoiceStatus(db, actor, params[0], body));
on('POST', 'invoices/:id/amend', ({ db, actor, params }) => amendInvoice(db, actor, params[0]));
on('GET', 'invoices/:id', ({ db, params }) => invoiceDetail(db, params[0]));
on('PATCH', 'invoices/:id', ({ db, actor, params, body }) => updateDraftInvoice(db, actor, params[0], body));
on('PUT', 'invoices/:id', ({ db, actor, params, body }) => updateDraftInvoice(db, actor, params[0], body));

/* Payments ----------------------------------------------------------------- */
on('GET', 'payments/entries', ({ db, url }) => listPaymentEntries(db, url));
on('POST', 'payments/entries', ({ db, actor, body }) => saveDraftPaymentEntry(db, actor, body));
on('PATCH', 'payments/entries/:id/status', ({ db, actor, params, body }) => changePaymentEntryStatus(db, actor, params[0], body));
on('GET', 'payments/entries/:id', ({ db, params }) => getPaymentEntry(db, params[0]));
on('PUT', 'payments/entries/:id', ({ db, actor, params, body }) => saveDraftPaymentEntry(db, actor, body, params[0]));
on('PATCH', 'payments/entries/:id', ({ db, actor, params, body }) => saveDraftPaymentEntry(db, actor, body, params[0]));
for (const base of ['payments', 'invoicing/payments']) {
  on('GET', base, ({ db, url }) => listPayments(db, url));
  on('POST', base, ({ db, actor, body }) => recordPayment(db, actor, body));
  on('PATCH', `${base}/:id/status`, ({ db, actor, params, body }) => {
    if (String(body?.status).toUpperCase() !== 'CANCELLED') throw new HttpError(400, 'Payments can only be cancelled (status CANCELLED).');
    return cancelPayment(db, actor, params[0], typeof body.reason === 'string' ? body.reason.slice(0, 500) : undefined);
  });
  on('GET', `${base}/:id`, ({ db, params }) => getPayment(db, params[0]));
}

/* Credit notes ------------------------------------------------------------- */
on('GET', 'invoicing/credit-notes', ({ db, url }) => listCreditNotes(db, url));
on('POST', 'invoicing/credit-notes/from-invoice/:id', ({ db, actor, params, body }) => saveDraftCreditNote(db, actor, body, { invoiceId: params[0] }));
on('POST', 'invoicing/credit-notes', ({ db, actor, body }) => saveDraftCreditNote(db, actor, body, { invoiceId: String(body?.originalInvoiceId || '') }));
on('PATCH', 'invoicing/credit-notes/:id/status', ({ db, actor, params, body }) => changeCreditNoteStatus(db, actor, params[0], body));
on('GET', 'invoicing/credit-notes/:id', ({ db, params }) => getCreditNote(db, params[0]));
on('PUT', 'invoicing/credit-notes/:id', ({ db, actor, params, body }) => saveDraftCreditNote(db, actor, body, { noteId: params[0] }));
on('PATCH', 'invoicing/credit-notes/:id', ({ db, actor, params, body }) => saveDraftCreditNote(db, actor, body, { noteId: params[0] }));

/* Delivery notes ----------------------------------------------------------- */
for (const base of ['delivery-notes', 'invoicing/delivery-notes']) {
  on('GET', base, ({ db, url }) => listDeliveryNotes(db, url));
  on('POST', base, ({ db, actor, body }) => saveDeliveryNote(db, actor, body));
  on('POST', `${base}/from-sales-order/:id`, ({ db, actor, params }) => deliveryFromSalesOrder(db, actor, params[0]));
  on('PATCH', `${base}/:id/status`, ({ db, actor, params, body }) => setDeliveryStatus(db, actor, params[0], body));
  on('GET', `${base}/:id`, ({ db, params }) => getDeliveryNote(db, params[0]));
  on('PUT', `${base}/:id`, ({ db, actor, params, body }) => saveDeliveryNote(db, actor, body, params[0]));
  on('PATCH', `${base}/:id`, ({ db, actor, params, body }) => saveDeliveryNote(db, actor, body, params[0]));
}

/* Setup: tax templates, print formats ------------------------------------- */
on('GET', 'invoicing/tax-templates', ({ db, url }) => listTaxTemplates(db, url));
on('POST', 'invoicing/tax-templates', ({ db, actor, body }) => saveTaxTemplate(db, actor, body));
on('GET', 'invoicing/tax-templates/:id', async ({ db, params }) => toApi(await db.collection<Doc>(C.taxTemplates).findOne({ _id: params[0] })) ?? Promise.reject(notFound('Tax template')));
on('PATCH', 'invoicing/tax-templates/:id', ({ db, actor, params, body }) => saveTaxTemplate(db, actor, body, params[0]));
on('PUT', 'invoicing/tax-templates/:id', ({ db, actor, params, body }) => saveTaxTemplate(db, actor, body, params[0]));
on('DELETE', 'invoicing/tax-templates/:id', ({ db, actor, params }) => saveTaxTemplate(db, actor, { isActive: false, isDefault: false }, params[0]));
on('GET', 'invoicing/print-formats', ({ db, url }) => listPrintFormats(db, url));
on('POST', 'invoicing/print-formats', ({ db, actor, body }) => savePrintFormat(db, actor, body));
on('GET', 'invoicing/print-formats/:id', async ({ db, params }) => toApi(await db.collection<Doc>(C.printFormats).findOne({ _id: params[0] })) ?? Promise.reject(notFound('Print format')));
on('PATCH', 'invoicing/print-formats/:id', ({ db, actor, params, body }) => savePrintFormat(db, actor, body, params[0]));
on('PUT', 'invoicing/print-formats/:id', ({ db, actor, params, body }) => savePrintFormat(db, actor, body, params[0]));
on('DELETE', 'invoicing/print-formats/:id', ({ db, actor, params }) => savePrintFormat(db, actor, { isActive: false, isDefault: false }, params[0]));

/* Subscriptions ------------------------------------------------------------ */
on('GET', 'invoicing/subscriptions', ({ db, url }) => listSubscriptions(db, url));
on('POST', 'invoicing/subscriptions/run-due', async ({ db, actor, body }) => {
  const asOf = typeof body?.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOfDate) ? body.asOfDate : undefined;
  const result = await runDueSubscriptions(db, actor, asOf);
  return Response.json({ success: true, message: result.message, data: result.data }, { status: 200 });
}, true);
on('POST', 'invoicing/subscriptions', ({ db, actor, body }) => saveSubscription(db, actor, body));
on('GET', 'invoicing/subscriptions/:id', async ({ db, params }) => toApi(await db.collection<Doc>(C.subscriptions).findOne({ _id: params[0] })) ?? Promise.reject(notFound('Subscription')));
on('PATCH', 'invoicing/subscriptions/:id', ({ db, actor, params, body }) => saveSubscription(db, actor, body, params[0]));
on('PUT', 'invoicing/subscriptions/:id', ({ db, actor, params, body }) => saveSubscription(db, actor, body, params[0]));

/* Shipping invoices + company profile -------------------------------------- */
on('GET', 'invoicing/company-profile', ({ db }) => getCompanyProfile(db));
on('PUT', 'invoicing/company-profile', ({ db, actor, body }) => saveCompanyProfile(db, actor, body));
on('GET', 'invoicing/shipping-invoices', ({ db, url }) => listShippingInvoices(db, url));
on('POST', 'invoicing/shipping-invoices', ({ db, actor, body }) => saveShippingInvoice(db, actor, body));
on('GET', 'invoicing/shipping-invoices/prefill/from-sales-invoice/:id', ({ db, params }) => prefillFromSalesInvoice(db, params[0]));
on('GET', 'invoicing/shipping-invoices/:id/pdf', async ({ db, params, url }) => {
  const { bytes, filename } = await shippingInvoicePdf(db, params[0]);
  const disposition = url.searchParams.get('download') === 'true' ? 'attachment' : 'inline';
  return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disposition}; filename="${filename}"`, 'Cache-Control': 'no-store' } });
}, true);
on('GET', 'invoicing/shipping-invoices/:id', ({ db, params }) => getShippingInvoice(db, params[0]));
on('PUT', 'invoicing/shipping-invoices/:id', ({ db, actor, params, body }) => saveShippingInvoice(db, actor, body, params[0]));
on('DELETE', 'invoicing/shipping-invoices/:id', ({ db, actor, params }) => deleteShippingInvoice(db, actor, params[0]));

/* Ledger, audit, reports --------------------------------------------------- */
on('GET', 'invoicing/ledger', ({ db, url }) => listLedger(db, url), true);
on('GET', 'invoicing/audit-logs', ({ db, url }) => listAuditLogs(db, url));
on('GET', 'invoicing/reports/aging', ({ db, url }) => agingReport(db, url), true);
on('GET', 'invoicing/reports/aging-report', ({ db, url }) => agingReport(db, url), true);
on('GET', 'invoicing/reports/outstanding', ({ db, url }) => outstandingReport(db, url), true);
on('GET', 'invoicing/reports/revenue-by-period', ({ db, url }) => revenueReport(db, url, 'period'), true);
on('GET', 'invoicing/reports/revenue-by-customer', ({ db, url }) => revenueReport(db, url, 'customer'), true);
on('GET', 'invoicing/reports/revenue-by-item', ({ db, url }) => revenueByItemReport(db, url), true);

/* Master data the invoicing flows depend on -------------------------------- */
on('GET', 'customers', ({ db, url }) => listCustomers(db, url));
on('POST', 'customers', ({ db, actor, body }) => saveCustomer(db, actor, body));
on('GET', 'customers/:id/invoices', async ({ db, params, url }) => {
  url.searchParams.set('customerId', params[0]);
  return listInvoices(db, url);
});
on('GET', 'customers/:id/outstanding', ({ db, params }) => customerOutstanding(db, params[0]));
on('GET', 'customers/:id', async ({ db, params }) => toApi(await db.collection<Doc>(C.customers).findOne({ _id: params[0] })) ?? Promise.reject(notFound('Customer')));
on('PUT', 'customers/:id', ({ db, actor, params, body }) => saveCustomer(db, actor, body, params[0]));
on('PATCH', 'customers/:id', ({ db, actor, params, body }) => saveCustomer(db, actor, body, params[0]));
on('DELETE', 'customers/:id', ({ db, params }) => softDelete(db, C.customers, params[0], 'Customer'));
on('GET', 'products/search', async ({ db, url }) => {
  if (!url.searchParams.get('limit')) url.searchParams.set('limit', '25');
  return (await listProducts(db, url)).items;
});
for (const base of ['products', 'inventory/products']) {
  on('GET', base, ({ db, url }) => listProducts(db, url));
  on('POST', base, ({ db, body }) => saveProduct(db, body));
  on('GET', `${base}/:id`, async ({ db, params }) => toApi(await db.collection<Doc>(C.products).findOne({ _id: params[0] })) ?? Promise.reject(notFound('Product')));
  on('PUT', `${base}/:id`, ({ db, params, body }) => saveProduct(db, body, params[0]));
  on('PATCH', `${base}/:id`, ({ db, params, body }) => saveProduct(db, body, params[0]));
  on('DELETE', `${base}/:id`, ({ db, params }) => softDelete(db, C.products, params[0], 'Product'));
}
on('GET', 'inventory/warehouses', ({ db }) => listWarehouses(db));
on('POST', 'inventory/warehouses', ({ db, body }) => saveWarehouse(db, body));
on('PUT', 'inventory/warehouses/:id', ({ db, params, body }) => saveWarehouse(db, body, params[0]));
on('PATCH', 'inventory/warehouses/:id', ({ db, params, body }) => saveWarehouse(db, body, params[0]));
on('DELETE', 'inventory/warehouses/:id', ({ db, params }) => softDelete(db, C.warehouses, params[0], 'Warehouse'));
on('GET', 'sales/orders', ({ db, url }) => listSalesOrders(db, url));
on('POST', 'sales/orders', ({ db, actor, body }) => saveSalesOrder(db, actor, body));
on('PUT', 'sales/orders/:id/status', ({ db, params, body }) => setSalesOrderStatus(db, params[0], body));
on('PATCH', 'sales/orders/:id/status', ({ db, params, body }) => setSalesOrderStatus(db, params[0], body));
on('GET', 'sales/orders/:id', ({ db, params }) => getSalesOrder(db, params[0]));
on('PUT', 'sales/orders/:id', ({ db, actor, params, body }) => saveSalesOrder(db, actor, body, params[0]));

async function readBody(request: Request): Promise<Doc> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase())) return {};
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export async function handleInvoiceBackend(request: Request, path: string[]) {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const route = path.map(segment => decodeURIComponent(segment)).join('/');
  try {
    // Demo authentication endpoints (pre-existing behaviour, no persistence).
    if (route === 'auth/login' && method === 'POST') {
      const body = await readBody(request);
      const email = typeof body.email === 'string' && body.email ? body.email : 'admin@example.com';
      const user = { id: 'demo-user-id', email, firstName: 'Demo', lastName: 'Admin', role: 'ADMIN', isActive: true, access: { isSuperAdmin: true, permissions: [], deniedPermissions: [], roles: [] } };
      return ok({ user, accessToken: 'invoice-demo-token', token: 'invoice-demo-token', expiresIn: 86400 });
    }
    if (route === 'auth/logout' && method === 'POST') return ok({ success: true });

    if (route === 'health' && method === 'GET') {
      const db = await getDb();
      await db.command({ ping: 1 });
      return Response.json({ success: true, service: 'invoicing-api', storage: 'mongodb', database: db.databaseName, transactions: await supportsTransactions() });
    }

    const matches = routes.filter(entry => entry.pattern.test(route));
    if (!matches.length) return Response.json({ success: false, message: `API route not found: ${method} /api/v1/${route}` }, { status: 404 });
    const match = matches.find(entry => entry.method === method);
    if (!match) return Response.json({ success: false, message: `Method ${method} not allowed for /api/v1/${route}` }, { status: 405, headers: { Allow: [...new Set(matches.map(entry => entry.method))].join(', ') } });

    const body = await readBody(request);
    const db = await getDb();
    const params = (route.match(match.pattern) || []).slice(1);
    const result = await match.handler({ db, url, body, actor: actorFrom(request), params, request });
    if (result instanceof Response) return result;
    if (match.raw) return Response.json(result);
    return ok(result, method === 'POST' ? 201 : 200);
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ success: false, message: error.message, ...(error.details ? { details: error.details } : {}) }, { status: error.status });
    }
    if (error instanceof DatabaseUnavailableError) {
      return Response.json({ success: false, code: 'DATABASE_UNAVAILABLE', message: error.message }, { status: 503 });
    }
    const name = (error as Error)?.name || '';
    if (/MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError|MongoTopologyClosedError/.test(name)) {
      return Response.json({ success: false, code: 'DATABASE_UNAVAILABLE', message: 'MongoDB is unavailable. The request was not saved.' }, { status: 503 });
    }
    const code = (error as { code?: number })?.code;
    if (code === 11000) return Response.json({ success: false, message: 'A record with the same unique number or code already exists. Retry the request.' }, { status: 409 });
    console.error(`[invoicing] ${method} /api/v1/${route} failed:`, (error as Error)?.message);
    return Response.json({ success: false, message: 'The request failed on the server and was not saved. Check the server log for details.' }, { status: 500 });
  }
}
