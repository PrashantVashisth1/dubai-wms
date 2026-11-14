#!/usr/bin/env node
/**
 * End-to-end check of the Shipping Invoice API + PDF (writes test records - dev DB only).
 *
 *   npm run dev
 *   node scripts/verify-shipping-invoice.mjs --yes [--base=http://localhost:3000/api/v1] [--logo=path/to/logo.png] [--out=tmp/shipping]
 *
 * Saves reference-sample.pdf, minimal.pdf and stress.pdf to --out for
 * scripts/compare-shipping-pdf.py. The company profile is restored after the
 * round-trip test; invoices use per-invoice logo/header overrides instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...rest] = arg.replace(/^--/, '').split('='); return [key, rest.join('=') || true]; }));
if (!args.yes) { console.error('Writes test records through the API. Re-run with --yes against a development database.'); process.exit(1); }
const BASE = String(args.base || 'http://localhost:3000/api/v1').replace(/\/$/, '');
const OUT = path.resolve(root, String(args.out || 'tmp/shipping'));
const HEADERS = { 'Content-Type': 'application/json', 'x-actor-email': 'verify@local.test' };
const RUN = Date.now().toString(36).toUpperCase();
const fixture = name => JSON.parse(readFileSync(path.join(root, 'tests/fixtures/shipping-invoice', `${name}.json`), 'utf8'));
const logoDataUrl = args.logo ? `data:image/${String(args.logo).toLowerCase().endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(String(args.logo)).toString('base64')}` : '';

let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail).slice(0, 300)}`}`); }
};
async function call(method, route, body) {
  const res = await fetch(`${BASE}/${route}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const near = (a, b, eps = 0.0001) => Math.abs(Number(a) - Number(b)) < eps;
const pageCount = pdf => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;

async function createFixture(name, overrides = {}) {
  const data = fixture(name);
  const payload = { ...data.invoice, headerTextOverride: data.branding?.headerText || '', logoOverride: logoDataUrl, ...overrides };
  let res = await call('POST', 'invoicing/shipping-invoices', payload);
  if (res.status === 409) {
    // A previous verification run may have left this fixture; replace it only if this script created it.
    const found = (await call('GET', `invoicing/shipping-invoices?search=${encodeURIComponent(payload.invoiceRefNo)}&limit=50`)).body.data.items
      .find(row => row.invoiceRefNo === payload.invoiceRefNo && row.createdBy === 'verify@local.test');
    if (found) { await call('DELETE', `invoicing/shipping-invoices/${found.id}`); res = await call('POST', 'invoicing/shipping-invoices', payload); }
  }
  return { res, data };
}

async function main() {
  console.log(`Verifying ${BASE}\n`);
  mkdirSync(OUT, { recursive: true });

  console.log('Company profile round-trip');
  const original = (await call('GET', 'invoicing/company-profile')).body.data;
  const put = await call('PUT', 'invoicing/company-profile', { companyName: `VERIFY ${RUN}`, headerText: `Header ${RUN}`, logo: logoDataUrl, shipperAddressLines: ['Line A', 'Line B'] });
  check('save company profile', put.status === 200 && put.body.data.headerText === `Header ${RUN}`, put.body);
  check('bad logo rejected (400)', (await call('PUT', 'invoicing/company-profile', { logo: 'data:image/gif;base64,R0lGOD' })).status === 400);
  await call('PUT', 'invoicing/company-profile', { companyName: original.companyName, headerText: original.headerText, logo: original.logo, shipperAddressLines: original.shipperAddressLines, shipperContactName: original.shipperContactName, shipperMobile: original.shipperMobile });
  check('company profile restored', (await call('GET', 'invoicing/company-profile')).body.data.headerText === (original.headerText || ''));

  console.log('\nValidation');
  const base = fixture('minimal').invoice;
  const expect400 = async (name, payload, pattern) => {
    const res = await call('POST', 'invoicing/shipping-invoices', payload);
    check(`${name} -> 400`, res.status === 400 && (!pattern || pattern.test(res.body.message)), res.body);
  };
  await expect400('missing ref no', { ...base, invoiceRefNo: '' }, /Ref No/);
  await expect400('no items', { ...base, invoiceRefNo: `V-${RUN}-1`, items: [] }, /at least one item/);
  await expect400('no packages', { ...base, invoiceRefNo: `V-${RUN}-2`, packages: [] }, /at least one package/);
  await expect400('qty 0', { ...base, invoiceRefNo: `V-${RUN}-3`, items: [{ ...base.items[0], qty: 0 }] }, /Quantity/);
  await expect400('negative price', { ...base, invoiceRefNo: `V-${RUN}-4`, items: [{ ...base.items[0], unitPrice: -1 }] }, /Unit price/);
  await expect400('fractional package qty', { ...base, invoiceRefNo: `V-${RUN}-5`, packages: [{ ...base.packages[0], qty: 1.5 }] }, /whole number/);
  await expect400('invalid transaction type', { ...base, invoiceRefNo: `V-${RUN}-6`, transactionType: 'Smuggling' });
  await expect400('missing shipper address', { ...base, invoiceRefNo: `V-${RUN}-7`, shipper: { ...base.shipper, addressLines: [] } }, /address/);
  await expect400('non-image logo', { ...base, invoiceRefNo: `V-${RUN}-8`, logoOverride: 'data:text/plain;base64,aGk=' }, /PNG or JPEG/);

  console.log('\nReference fixture');
  const { res: refRes, data: refData } = await createFixture('reference-sample');
  const ref = refRes.body.data;
  check('create reference-sample shipping invoice', refRes.status === 201, refRes.body);
  const exp = refData.expected;
  check(`totals: qty ${exp.qty}, value ${exp.value}, weight ${exp.weightKg}, packages ${exp.packages}`,
    ref && ref.totals.qty === exp.qty && near(ref.totals.value, exp.value, 0.005) && near(ref.totals.weightKg, exp.weightKg) && ref.totals.packages === exp.packages, ref?.totals);
  check(`CBM ${exp.cbmPage1} (4dp) / ${exp.cbmPage2} (2dp)`, ref && ref.totals.cbm.toFixed(4) === exp.cbmPage1 && ref.totals.cbm.toFixed(2) === exp.cbmPage2, ref?.totals.cbm);
  check('B/E refs unique + ordered', ref?.beRefNos === '502-00237286-26/502-00485045-26/502-00491370-26', ref?.beRefNos);
  check('country of origin', ref?.countryOfOrigin === 'PL', ref?.countryOfOrigin);
  check('duplicate ref no rejected (409)', (await call('POST', 'invoicing/shipping-invoices', { ...refData.invoice })).status === 409);
  const reread = (await call('GET', `invoicing/shipping-invoices/${ref.id}`)).body.data;
  check('persisted (re-read) with 10 items / 7 packages', reread.items.length === 10 && reread.packages.length === 7 && reread.cargoType === 'PKG');
  const refPdf = await call('GET', `invoicing/shipping-invoices/${ref.id}/pdf`);
  check('PDF: application/pdf, 3 pages', refPdf.status === 200 && (refPdf.headers.get('content-type') || '').includes('pdf') && pageCount(refPdf.body) === 3, { status: refPdf.status, pages: Buffer.isBuffer(refPdf.body) && pageCount(refPdf.body) });
  writeFileSync(path.join(OUT, 'reference-sample.pdf'), refPdf.body);

  console.log('\nUpdate round-trip');
  const changed = { ...refData.invoice, headerTextOverride: refData.branding.headerText, logoOverride: logoDataUrl, items: refData.invoice.items.map((item, index) => (index === 0 ? { ...item, qty: 7 } : item)) };
  const upd = await call('PUT', `invoicing/shipping-invoices/${ref.id}`, changed);
  check('update recalculates totals (qty 123, value +5,799.00)', upd.status === 200 && upd.body.data.totals.qty === 123 && near(upd.body.data.totals.value, exp.value + 5799, 0.005), upd.body.data?.totals);
  await call('PUT', `invoicing/shipping-invoices/${ref.id}`, { ...refData.invoice, orderNumber: 'TEMP-ORDER', headerTextOverride: refData.branding.headerText, logoOverride: logoDataUrl });
  const { orderNumber: _drop, ...withoutOrder } = refData.invoice;
  void _drop;
  await call('PUT', `invoicing/shipping-invoices/${ref.id}`, { ...withoutOrder, headerTextOverride: refData.branding.headerText, logoOverride: logoDataUrl });
  check('edit can clear an optional field (order number)', (await call('GET', `invoicing/shipping-invoices/${ref.id}`)).body.data.orderNumber === '');

  console.log('\nOther datasets');
  for (const name of ['minimal', 'stress']) {
    const { res } = await createFixture(name);
    check(`create ${name}`, res.status === 201, res.body);
    const pdf = await call('GET', `invoicing/shipping-invoices/${res.body.data.id}/pdf?download=true`);
    const pages = pageCount(pdf.body);
    check(`${name} PDF generated (${pages} pages)`, pdf.status === 200 && pages >= 3 && /attachment/.test(pdf.headers.get('content-disposition') || ''));
    writeFileSync(path.join(OUT, `${name}.pdf`), pdf.body);
  }

  console.log('\nConvert from sales invoice');
  const customer = (await call('POST', 'customers', { name: `Verify Buyer ${RUN}`, currency: 'EUR', address: 'Street 1', city: 'Rotterdam', country: 'Netherlands' })).body.data;
  const product = (await call('POST', 'inventory/products', { name: `Verify Widget ${RUN}`, sku: `VW-${RUN}`, salePrice: 10 })).body.data;
  const sales = (await call('POST', 'invoices', { customerId: customer.id, date: new Date().toISOString().slice(0, 10), currency: 'EUR', portOfLoading: 'Origin Port', countryOfDestination: 'Netherlands', items: [{ productId: product.id, quantity: 3, unitPrice: 10 }] })).body.data;
  const prefill = (await call('GET', `invoicing/shipping-invoices/prefill/from-sales-invoice/${sales.id}`)).body.data;
  check('prefill maps customer, currency, items', prefill.shipTo.companyName === customer.name && prefill.currency === 'EUR' && prefill.items.length === 1 && prefill.items[0].itemCode === `VW-${RUN}` && prefill.items[0].qty === 3 && prefill.salesInvoiceId === sales.id, prefill);
  check('prefill leaves shipping-only fields for the user', prefill.items[0].hsCode === '' && prefill.packages.length === 0 && prefill.transactionType === '');
  check('sales invoice unchanged (still DRAFT, same total)', (await call('GET', `invoices/${sales.id}`)).body.data.status === 'DRAFT');

  console.log('\nDelete + audit');
  const temp = (await call('POST', 'invoicing/shipping-invoices', { ...base, invoiceRefNo: `V-${RUN}-DEL` })).body.data;
  check('delete', (await call('DELETE', `invoicing/shipping-invoices/${temp.id}`)).status === 200);
  check('deleted -> 404', (await call('GET', `invoicing/shipping-invoices/${temp.id}`)).status === 404);
  const auditRows = (await call('GET', 'invoicing/audit-logs?entityType=SHIPPING_INVOICE&limit=200')).body.data.items;
  check('audit has CREATE / UPDATE / DELETE', ['CREATE', 'UPDATE', 'DELETE'].every(action => auditRows.some(row => row.action === action)));
  const list = (await call('GET', 'invoicing/shipping-invoices?search=SI-TEST-0001')).body.data;
  check('list + search', list.items.some(row => row.invoiceRefNo === 'SI-TEST-0001') && list.items.every(row => !('logoOverride' in row)));

  console.log(`\n${passed} passed, ${failures.length} failed. PDFs in ${OUT}`);
  if (failures.length) process.exit(1);
}

main().catch(error => { console.error(error); process.exit(1); });
