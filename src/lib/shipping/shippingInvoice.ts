/**
 * Shipping Invoice: shared types, calculations and display formats.
 * Used by the form (live preview), the API (persisted totals) and the PDF,
 * so all three always agree. Calculations use unrounded values; rounding
 * happens only in the format helpers.
 */

export const TRANSACTION_TYPES = ['Import', 'Import for Re-Export', 'Temporary Exit', 'Free Zone Internal Transfer', 'Export', 'Free Zone B/E'] as const;
export const PAYMENT_METHODS = ['CDR Cash', 'CDR Bank', 'Deposit', 'Credit A/C', 'Stan G', 'Bank G', 'FTT', 'Others'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type ShippingPaymentMethod = (typeof PAYMENT_METHODS)[number];

export type ShippingParty = {
  companyName: string;
  addressLines: string[];
  country?: string;
  contactName?: string;
  contactPerson?: string;
  mobile?: string;
  email?: string;
};

export type ShippingItem = {
  itemCode: string;
  description: string;
  qty: number;
  serialNo?: string;
  unitPrice: number;
  hsCode: string;
  eccn?: string;
  coo: string;
  inboundRef: string;
  grossWeightKg: number;
};

export type ShippingPackage = { lengthCm: number; widthCm: number; heightCm: number; qty: number };

export type ShippingInvoiceInput = {
  date: string; // YYYY-MM-DD
  invoiceRefNo: string;
  orderNumber?: string;
  currency: string;
  importerCode?: string;
  agentCode?: string;
  repCardNo?: string;
  shipper: ShippingParty;
  shipTo: ShippingParty;
  fromLocation: string;
  toCountry: string;
  transactionType: TransactionType;
  paymentMethod?: ShippingPaymentMethod | '';
  refAcNo?: string;
  goodsDescription: string;
  hsCodeLabel?: string;
  marksAndNumbers?: string;
  /** Delivery Advice "Type" column (e.g. a customs package-type code). */
  cargoType: string;
  /** Unit name used with the package count, e.g. "<N> <packageType>". */
  packageType: string;
  carrierAgent?: string;
  headerTextOverride?: string;
  logoOverride?: string; // data URL (PNG/JPEG)
  salesInvoiceId?: string;
  items: ShippingItem[];
  packages: ShippingPackage[];
};

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Unique non-empty values, first-seen order preserved. */
export function uniqueOrdered(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').trim();
    if (value && !seen.has(value)) { seen.add(value); out.push(value); }
  }
  return out;
}

export function computeShipping(input: Pick<ShippingInvoiceInput, 'items' | 'packages'>) {
  const lines = (input.items || []).map(item => ({ ...item, lineTotal: num(item.qty) * num(item.unitPrice) }));
  const packages = (input.packages || []).map(pkg => {
    const rowCbm = (num(pkg.lengthCm) * num(pkg.widthCm) * num(pkg.heightCm)) / 1_000_000;
    return { ...pkg, rowCbm, rowTotalCbm: rowCbm * num(pkg.qty) };
  });
  const totals = {
    qty: lines.reduce((sum, line) => sum + num(line.qty), 0),
    value: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    weightKg: lines.reduce((sum, line) => sum + num(line.grossWeightKg), 0),
    packages: packages.reduce((sum, pkg) => sum + num(pkg.qty), 0),
    cbm: packages.reduce((sum, pkg) => sum + pkg.rowTotalCbm, 0),
  };
  return {
    lines,
    packages,
    totals,
    beRefNos: uniqueOrdered(lines.map(line => line.inboundRef)).join('/'),
    countryOfOrigin: uniqueOrdered(lines.map(line => line.coo)).join('/'),
  };
}

/* ---------------------------------------------------------------- formats */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateParts(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!match) return null;
  return { year: match[1], month: Number(match[2]), day: match[3] };
}
/** Page 1: DD/MM/YYYY */
export function formatDateSlash(iso: string) {
  const parts = dateParts(iso);
  return parts ? `${parts.day}/${String(parts.month).padStart(2, '0')}/${parts.year}` : '';
}
/** Pages 2 and 3: DD-Mon-YY */
export function formatDateShort(iso: string) {
  const parts = dateParts(iso);
  return parts ? `${parts.day}-${MONTHS[parts.month - 1]}-${parts.year.slice(-2)}` : '';
}

/** 1,234.50 */
export function formatMoney(value: number) {
  return num(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** 1234.50 (no grouping) */
export function formatPlain2(value: number) {
  return num(value).toFixed(2);
}
/** Quantities / weights shown without forced decimals: 4807, 12.5 */
export function formatQuantity(value: number) {
  return String(Math.round(num(value) * 1000) / 1000);
}
export function formatCbm(value: number, decimals: number) {
  return num(value).toFixed(decimals);
}
export function formatCurrencyValue(currency: string, value: number) {
  return `${currency} ${formatMoney(value)}`;
}
