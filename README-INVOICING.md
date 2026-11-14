# Invoicing module – MongoDB backend

The Invoicing section (sidebar → **Invoices**) is served by the Route Handler
`src/app/api/v1/[...path]/route.ts` → `src/lib/invoiceBackend.ts`, with all
data in MongoDB (official `mongodb` driver). The old `data/invoice-demo.json`
file is **no longer read or written**.

## Setup

1. Copy `.env.example` to `.env.local` and set `MONGODB_URI` (and optionally `MONGODB_DB`).
   `.env.local` is git-ignored – never commit it.
2. Install and prepare the database:

   ```bash
   npm install
   npm run db:setup          # indexes + collection validators, reports transaction support
   npm run db:seed           # optional demo masters (customers, products, VAT templates, print formats, warehouse)
   npm run db:migrate-json   # optional: import a legacy data/invoice-demo.json (add --dry-run first)
   npm run dev
   ```

   `db:seed` and `db:migrate-json` only insert missing records (`$setOnInsert`); they never overwrite existing data.
   `db:seed` refuses to run with `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true`.

3. Verify end to end (writes tagged `VERIFY-…` test records – use a dev database):

   ```bash
   npm run verify:invoicing -- --yes                     # against http://localhost:3000/api/v1
   npm run verify:invoicing -- --yes --base=http://localhost:3100/api/v1
   ```

   `GET /api/v1/health` shows the database name and whether transactions are available.

## Transactions

- **Atlas / replica set**: every multi-document workflow (submit, payment, payment entry, credit note,
  delivery-note conversion, cancel, amend) runs in one MongoDB transaction.
- **Standalone `mongod`**: transactions are impossible. The code then uses guarded conditional
  updates (e.g. a payment only applies if `outstandingAmount >= amount`) plus a compensation stack that
  undoes earlier steps when a later one fails. Concurrency is still safe, but a process crash in the
  middle of a workflow could leave a partial write. Use a replica set (even a single-node one:
  `mongod --replSet rs0` + `rs.initiate()`) for anything beyond local development.

## Collections & indexes

| Collection | Key indexes |
|---|---|
| `invoices` | unique `invoiceNo`; unique partial `deliveryNoteLock`, `salesOrderLock`, `subscriptionRunKey`, `amendedFromId`; `status+date`, `customerId+status`, `dueDate+outstandingAmount` |
| `payments` | unique `paymentNo`; `invoiceId+status`, `customerId+date` |
| `payment_entries` | unique `paymentNo`; `allocations.invoiceId+status` |
| `credit_notes` | unique `creditNoteNo`; `originalInvoiceId+status` |
| `delivery_notes` | unique `deliveryNo`; `salesOrderId`, `status+createdAt` |
| `tax_templates` | unique `code` |
| `print_formats` | unique `docType+name`; default lookup |
| `ledger_entries` | `postingDate`, `voucherType+voucherNo`, `entityId`, `account.code` |
| `subscriptions` | `isActive+nextRunDate` |
| `invoice_audit_logs` | `createdAt`, `entityType+action`, `entityId` |
| `customers`, `products`, `warehouses`, `sales_orders` | unique `customerNo` / `sku` / `code` / `orderNo` |
| `counters` | one doc per prefix+year (`INV-26`, `PAY-26`, …) incremented atomically with `$inc` |

`db:setup` also applies `$jsonSchema` validators (level `moderate`) to `invoices`, `payments` and
`ledger_entries`. If the DB user lacks `collMod` rights it skips them with a warning; the API validates
every write with zod regardless.

## Status rules

- Invoice: `DRAFT` → (edit) → `SUBMITTED` → `PARTIAL` → `PAID` / `CREDITED`; `DRAFT|SUBMITTED` → `CANCELLED` → **Amend** (new draft, once).
  Invoices with payments/credits cannot be cancelled – cancel the payment or issue a credit note.
- Payments only apply to `SUBMITTED`/`PARTIAL` invoices; overpayment is rejected (use a Payment Entry
  to keep an advance). Payments can be cancelled (balance + ledger reversed).
- Payment entry, credit note, delivery note: `DRAFT` (editable) → `SUBMITTED` → `CANCELLED` (reverses effects).
  Delivery notes become `INVOICED` when converted; cancelling that invoice frees the note again.
- Submitting checks the customer credit limit (when `creditLimit > 0`) per currency.

## Known limitations

- Authentication is still the pre-existing demo login; the audit log records the email sent in the
  `x-actor-email` header by the frontend, which is not a verified identity.
- Delivery notes do not move inventory stock (no stock ledger exists in this repository's backend).
- Reports sum amounts in document currency without FX conversion; use the currency filter when
  invoices are issued in several currencies.
- Aging is calculated from current outstanding balances (payments dated after the as-of date are not unwound).
- The invoice PDF uses built-in Helvetica (Latin-1); non-Latin characters are replaced with `?`.

## Shipping Invoice (3-page PDF)

Sidebar: **Invoices → Shipping Invoices** (and **Company Profile**). Sales invoices are unchanged; a
sales invoice page has a **Shipping Invoice** button that opens a new shipping invoice pre-filled from it
(customer → ship-to, items, currency, PO). Data lives in the `shipping_invoices` collection
(unique `invoiceRefNo`); logo + header line live in `company_settings` (one document) and can be
overridden per invoice.

PDF (`GET /api/v1/invoicing/shipping-invoices/:id/pdf[?download=true]`):
1. DELIVERY ADVICE (A4 portrait) 2. INVOICE / PACKING LIST (A4 landscape) 3. DETAILED COMMODITY
CLASSIFICATION FORM (A4 portrait). Pages 2 and 3 continue onto extra pages with repeated table headers
when there are many rows; totals always print after the last row. Totals, CBM, B/E Ref Nos. and country of
origin are calculated by `src/lib/shipping/shippingInvoice.ts` (shared by the form preview, API and PDF).

Fonts: page 1 uses PDF Helvetica (same metrics as Arial); pages 2–3 embed **Carlito** (SIL OFL,
metric-compatible with Calibri) from `src/lib/server/pdf/fonts/`. Regenerate `fontData.ts` with
`python scripts/generate-pdf-fonts.py` if the fonts change. No PDF library dependency.

Verification:

```bash
npm run dev
node scripts/verify-shipping-invoice.mjs --yes [--base=http://localhost:3000/api/v1] [--logo=logo.png] [--out=tmp/shipping]
# visual parity against the client's reference PDF (Python + pypdfium2 + Pillow):
python scripts/compare-shipping-pdf.py --extract-logo <reference.pdf> tmp/logo.png   # test-only logo
python scripts/compare-shipping-pdf.py <reference.pdf> tmp/shipping/reference-sample.pdf tmp/shipping/compare
```

Test fixtures (`tests/fixtures/shipping-invoice/`): `reference-sample.json` (values from the client's
reference PDF – test only), `minimal.json` (1 item / 1 package), `stress.json` (30 items, 28 package rows,
EUR, long text, accents).
