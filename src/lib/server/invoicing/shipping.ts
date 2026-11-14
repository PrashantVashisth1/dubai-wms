import type { Db } from 'mongodb';
import { z } from 'zod';
import { PdfWriter } from '../pdf/pdfWriter';
import {
  PAYMENT_METHODS, TRANSACTION_TYPES, computeShipping, type ShippingInvoiceInput,
} from '../../shipping/shippingInvoice';
import {
  audit, badRequest, conflict, escapeRegex, isDuplicateKey, newId, notFound, nowIso, pageEnvelope, paginateParams, toApi, todayIso,
  type Actor, type Doc,
} from './core';
import { C } from './indexes.mjs';
import { renderShippingInvoicePdf } from './shippingPdf';
import { parse } from './validation';

/* ------------------------------------------------------------- validation */

const blank = (value: unknown) => (value === '' || value === null ? undefined : value);
const text = (max = 200) => z.preprocess(blank, z.string().trim().max(max).optional());
const required = (label: string, max = 200) => z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);
const isoDate = z.string({ error: 'Date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine(value => !Number.isNaN(Date.parse(value)), 'Date is not valid');
const positive = (label: string) => z.coerce.number({ error: `${label} must be a number` }).finite().refine(value => value > 0, `${label} must be greater than zero`);
const lines = (max: number) => z.array(z.string().trim().max(200)).max(max).default([]).transform(values => values.filter(Boolean));

/** Logo override / company logo: PNG or JPEG data URL, max ~1.5 MB. */
export const logoDataUrl = z.preprocess(blank, z.string().max(2_100_000, 'Logo must be 1.5 MB or smaller')
  .regex(/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG or JPEG image').optional());

const party = (label: string) => z.object({
  companyName: required(`${label} company name`),
  addressLines: lines(8),
  country: text(100),
  contactName: text(120),
  contactPerson: text(120),
  mobile: text(60),
  email: z.preprocess(blank, z.string().trim().email(`${label} email is not valid`).max(200).optional()),
});

export const shippingInvoiceSchema = z.object({
  date: isoDate,
  invoiceRefNo: required('Invoice / Ref No.', 120),
  orderNumber: text(120),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter code').default('USD'),
  importerCode: text(60),
  agentCode: text(60),
  repCardNo: text(60),
  shipper: party('Shipper').refine(value => value.addressLines.length > 0, { message: 'Shipper address is required', path: ['addressLines'] }),
  shipTo: party('Ship-to').refine(value => value.addressLines.length > 0, { message: 'Ship-to address is required', path: ['addressLines'] }),
  fromLocation: required('From (location)', 100),
  toCountry: required('To (country)', 100),
  transactionType: z.enum(TRANSACTION_TYPES, { error: 'Select a transaction type' }),
  paymentMethod: z.preprocess(blank, z.enum(PAYMENT_METHODS, { error: 'Select a valid payment method' }).optional()),
  refAcNo: text(80),
  goodsDescription: required('Description of goods', 300),
  hsCodeLabel: text(120),
  marksAndNumbers: text(300),
  cargoType: required('Type', 30),
  packageType: required('Package type', 30),
  carrierAgent: text(200),
  headerTextOverride: text(200),
  logoOverride: logoDataUrl,
  salesInvoiceId: text(100),
  items: z.array(z.object({
    itemCode: required('Item code', 80),
    description: required('Item description', 300),
    qty: positive('Quantity'),
    serialNo: text(120),
    unitPrice: positive('Unit price'),
    hsCode: required('HS code', 30),
    eccn: text(30),
    coo: required('Country of origin', 40),
    inboundRef: required('Inbound ref', 80),
    grossWeightKg: positive('Gross weight (kg)'),
  }), { error: 'Items are required' }).min(1, 'Add at least one item').max(500, 'Too many items'),
  packages: z.array(z.object({
    lengthCm: positive('Length (cm)'),
    widthCm: positive('Width (cm)'),
    heightCm: positive('Height (cm)'),
    qty: positive('Package quantity').refine(Number.isInteger, 'Package quantity must be a whole number'),
  }), { error: 'Packages are required' }).min(1, 'Add at least one package').max(300, 'Too many package rows'),
});

export const companyProfileSchema = z.object({
  companyName: text(200),
  headerText: text(200),
  logo: logoDataUrl,
  shipperAddressLines: lines(8),
  shipperContactName: text(120),
  shipperMobile: text(60),
});

/* ---------------------------------------------------------------- helpers */

const OPTIONAL_FIELDS = ['orderNumber', 'importerCode', 'agentCode', 'repCardNo', 'paymentMethod', 'refAcNo', 'hsCodeLabel', 'marksAndNumbers', 'carrierAgent', 'headerTextOverride', 'logoOverride', 'salesInvoiceId'] as const;
const shipping = (db: Db) => db.collection<Doc>(C.shippingInvoices);
const settings = (db: Db) => db.collection<Doc>(C.companySettings);
const PROFILE_ID = 'default';

function decodeLogo(dataUrl?: string | null) {
  if (!dataUrl) return null;
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Buffer.from(base64, 'base64');
}

/** Rejects images the PDF writer cannot embed (e.g. 16-bit or interlaced PNG) at save time. */
function assertEmbeddableLogo(dataUrl?: string) {
  if (!dataUrl) return;
  try {
    new PdfWriter().addImage(decodeLogo(dataUrl)!);
  } catch (error) {
    throw badRequest((error as Error).message || 'Logo image could not be read.');
  }
}

function snapshot(input: ShippingInvoiceInput) {
  const calc = computeShipping(input);
  return { totals: calc.totals, beRefNos: calc.beRefNos, countryOfOrigin: calc.countryOfOrigin };
}

function listView(doc: Doc) {
  const { logoOverride, ...rest } = toApi(doc);
  return { ...rest, hasLogoOverride: Boolean(logoOverride) };
}

/* --------------------------------------------------------- company profile */

export async function getCompanyProfile(db: Db) {
  const profile = await settings(db).findOne({ _id: PROFILE_ID });
  return profile ? toApi(profile) : { id: PROFILE_ID, companyName: '', headerText: '', logo: '', shipperAddressLines: [], shipperContactName: '', shipperMobile: '' };
}

export async function saveCompanyProfile(db: Db, actor: Actor, body: unknown) {
  const input = parse(companyProfileSchema, body);
  assertEmbeddableLogo(input.logo);
  const timestamp = nowIso();
  await settings(db).updateOne(
    { _id: PROFILE_ID },
    // PUT replaces the whole profile: omitted/empty fields are cleared, not kept.
    {
      $set: {
        companyName: input.companyName ?? '', headerText: input.headerText ?? '', logo: input.logo ?? '',
        shipperAddressLines: input.shipperAddressLines ?? [], shipperContactName: input.shipperContactName ?? '', shipperMobile: input.shipperMobile ?? '',
        updatedAt: timestamp, updatedBy: actor.email,
      },
      $setOnInsert: { id: PROFILE_ID, createdAt: timestamp },
    },
    { upsert: true },
  );
  await audit(db, undefined, actor, { entityType: 'COMPANY_PROFILE', action: 'UPDATE', entityId: PROFILE_ID, voucher: input.companyName || 'Company profile', message: `Updated company profile${input.logo ? ' (logo set)' : ''}` });
  return getCompanyProfile(db);
}

/* ------------------------------------------------------- shipping invoices */

export async function listShippingInvoices(db: Db, url: URL) {
  const { page, limit, skip } = paginateParams(url);
  const query: Doc = {};
  const search = url.searchParams.get('search')?.trim();
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    query.$or = [{ invoiceRefNo: pattern }, { 'shipTo.companyName': pattern }, { 'shipper.companyName': pattern }, { orderNumber: pattern }];
  }
  const [rows, total] = await Promise.all([
    shipping(db).find(query, { projection: { logoOverride: 0 } }).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit).toArray(),
    shipping(db).countDocuments(query),
  ]);
  return pageEnvelope(rows.map(listView), total, page, limit);
}

export async function getShippingInvoice(db: Db, id: string) {
  const doc = await shipping(db).findOne({ _id: id });
  if (!doc) throw notFound('Shipping invoice');
  return toApi(doc);
}

export async function saveShippingInvoice(db: Db, actor: Actor, body: unknown, id?: string) {
  const input = parse(shippingInvoiceSchema, body) as ShippingInvoiceInput;
  assertEmbeddableLogo(input.logoOverride);
  const timestamp = nowIso();
  // Optional fields are written as '' when empty so an edit can clear them.
  const cleared = Object.fromEntries(OPTIONAL_FIELDS.map(key => [key, (input as Record<string, unknown>)[key] ?? '']));
  const fields = { ...input, ...cleared, ...snapshot(input), updatedAt: timestamp, updatedBy: actor.email };
  try {
    if (id) {
      const existing = await shipping(db).findOne({ _id: id }, { projection: { invoiceRefNo: 1 } });
      if (!existing) throw notFound('Shipping invoice');
      await shipping(db).updateOne({ _id: id }, { $set: fields });
      await audit(db, undefined, actor, { entityType: 'SHIPPING_INVOICE', action: 'UPDATE', entityId: id, voucher: input.invoiceRefNo, message: `Updated shipping invoice ${input.invoiceRefNo} (${input.items.length} item(s), ${input.packages.length} package row(s))` });
      return getShippingInvoice(db, id);
    }
    const newIdValue = newId();
    await shipping(db).insertOne({ _id: newIdValue, id: newIdValue, ...fields, createdAt: timestamp, createdBy: actor.email });
    await audit(db, undefined, actor, { entityType: 'SHIPPING_INVOICE', action: 'CREATE', entityId: newIdValue, voucher: input.invoiceRefNo, message: `Created shipping invoice ${input.invoiceRefNo} for ${input.shipTo.companyName}` });
    return getShippingInvoice(db, newIdValue);
  } catch (error) {
    if (isDuplicateKey(error)) throw conflict(`A shipping invoice with Invoice / Ref No. "${input.invoiceRefNo}" already exists.`);
    throw error;
  }
}

export async function deleteShippingInvoice(db: Db, actor: Actor, id: string) {
  const doc = await shipping(db).findOneAndDelete({ _id: id });
  if (!doc) throw notFound('Shipping invoice');
  await audit(db, undefined, actor, { entityType: 'SHIPPING_INVOICE', action: 'DELETE', entityId: id, voucher: doc.invoiceRefNo, message: `Deleted shipping invoice ${doc.invoiceRefNo}` });
  return { id, deleted: true };
}

export async function shippingInvoicePdf(db: Db, id: string) {
  const doc = await shipping(db).findOne({ _id: id });
  if (!doc) throw notFound('Shipping invoice');
  const profile = await settings(db).findOne({ _id: PROFILE_ID });
  const input = doc as unknown as ShippingInvoiceInput;
  const bytes = renderShippingInvoicePdf(input, {
    logo: decodeLogo(input.logoOverride || profile?.logo),
    headerText: input.headerTextOverride || profile?.headerText || '',
  });
  const safeName = String(doc.invoiceRefNo).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'shipping-invoice';
  return { bytes, filename: `Shipping-Invoice-${safeName}.pdf` };
}

/**
 * "Convert" a sales invoice: returns an unsaved shipping-invoice draft pre-filled
 * from the sales invoice, its customer and the company profile. Fields the sales
 * invoice does not know (HS code per line, COO, inbound refs, weights, packages)
 * are left empty for the user to complete.
 */
export async function prefillFromSalesInvoice(db: Db, salesInvoiceId: string) {
  const invoice = await db.collection<Doc>(C.invoices).findOne({ _id: salesInvoiceId });
  if (!invoice) throw notFound('Sales invoice');
  const [customer, profile] = await Promise.all([
    db.collection<Doc>(C.customers).findOne({ _id: invoice.customerId }),
    settings(db).findOne({ _id: PROFILE_ID }),
  ]);
  const productIds = (invoice.items || []).map((item: Doc) => item.productId).filter(Boolean);
  const products = productIds.length ? await db.collection<Doc>(C.products).find({ _id: { $in: productIds } }).toArray() : [];
  const productMap = new Map(products.map(product => [String(product._id), product]));
  return {
    date: todayIso(),
    invoiceRefNo: invoice.invoiceNo,
    orderNumber: invoice.customerPoNo || '',
    currency: invoice.currency || 'USD',
    shipper: {
      companyName: profile?.companyName || '',
      addressLines: profile?.shipperAddressLines || [],
      contactName: profile?.shipperContactName || '',
      mobile: profile?.shipperMobile || '',
    },
    shipTo: {
      companyName: customer?.name || '',
      addressLines: [customer?.address, [customer?.city, customer?.state, customer?.postalCode].filter(Boolean).join(', ')].filter(Boolean),
      country: customer?.country || '',
      contactPerson: '',
      mobile: customer?.phone || '',
      email: customer?.email || '',
    },
    fromLocation: invoice.portOfLoading || '',
    toCountry: invoice.countryOfDestination || customer?.country || '',
    transactionType: '',
    marksAndNumbers: invoice.shipmentReference || '',
    items: (invoice.items || []).map((item: Doc) => ({
      itemCode: item.itemCode || productMap.get(item.productId)?.sku || '',
      description: item.description || productMap.get(item.productId)?.name || '',
      qty: item.quantity,
      unitPrice: item.unitPrice,
      serialNo: '', hsCode: '', eccn: '', coo: '', inboundRef: '', grossWeightKg: '',
    })),
    packages: [],
    salesInvoiceId: invoice.id,
  };
}
