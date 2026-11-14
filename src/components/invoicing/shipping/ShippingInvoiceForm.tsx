'use client';

import { useMemo, useState } from 'react';
import { Copy, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencySelect } from '@/components/ui/currency-select';
import {
  PAYMENT_METHODS, TRANSACTION_TYPES, computeShipping, formatCbm, formatCurrencyValue, formatQuantity,
  type ShippingInvoiceInput,
} from '@/lib/shipping/shippingInvoice';

/** Form state keeps numbers as strings so inputs can be empty while typing. */
export type ItemRow = { itemCode: string; description: string; qty: string; serialNo: string; unitPrice: string; hsCode: string; eccn: string; coo: string; inboundRef: string; grossWeightKg: string };
export type PackageRow = { lengthCm: string; widthCm: string; heightCm: string; qty: string };
export type ShippingFormState = {
  date: string; invoiceRefNo: string; orderNumber: string; currency: string;
  importerCode: string; agentCode: string; repCardNo: string;
  shipperCompany: string; shipperAddress: string; shipperContact: string; shipperMobile: string;
  shipToCompany: string; shipToAddress: string; shipToCountry: string; shipToContact: string; shipToMobile: string; shipToEmail: string;
  fromLocation: string; toCountry: string; carrierAgent: string; marksAndNumbers: string;
  cargoType: string; packageType: string; goodsDescription: string; hsCodeLabel: string;
  transactionType: string; paymentMethod: string; refAcNo: string;
  headerTextOverride: string; logoOverride: string; salesInvoiceId: string;
  items: ItemRow[]; packages: PackageRow[];
};

export const emptyItem = (): ItemRow => ({ itemCode: '', description: '', qty: '', serialNo: '', unitPrice: '', hsCode: '', eccn: '', coo: '', inboundRef: '', grossWeightKg: '' });
export const emptyPackage = (): PackageRow => ({ lengthCm: '', widthCm: '', heightCm: '', qty: '' });

export function emptyShippingForm(): ShippingFormState {
  return {
    date: new Date().toISOString().slice(0, 10), invoiceRefNo: '', orderNumber: '', currency: 'USD',
    importerCode: '', agentCode: '', repCardNo: '',
    shipperCompany: '', shipperAddress: '', shipperContact: '', shipperMobile: '',
    shipToCompany: '', shipToAddress: '', shipToCountry: '', shipToContact: '', shipToMobile: '', shipToEmail: '',
    fromLocation: '', toCountry: '', carrierAgent: '', marksAndNumbers: '',
    cargoType: '', packageType: '', goodsDescription: '', hsCodeLabel: '',
    transactionType: '', paymentMethod: '', refAcNo: '',
    headerTextOverride: '', logoOverride: '', salesInvoiceId: '',
    items: [emptyItem()], packages: [emptyPackage()],
  };
}

type Loose = Partial<Omit<ShippingInvoiceInput, 'items' | 'packages'>> & {
  items?: Array<Partial<Record<keyof ItemRow, string | number>>>;
  packages?: Array<Partial<Record<keyof PackageRow, string | number>>>;
};
const str = (value: unknown) => (value === undefined || value === null ? '' : String(value));

/** API document (or prefill payload) -> form state. */
export function toFormState(doc: Loose): ShippingFormState {
  const base = emptyShippingForm();
  return {
    ...base,
    date: str(doc.date) || base.date, invoiceRefNo: str(doc.invoiceRefNo), orderNumber: str(doc.orderNumber), currency: str(doc.currency) || 'USD',
    importerCode: str(doc.importerCode), agentCode: str(doc.agentCode), repCardNo: str(doc.repCardNo),
    shipperCompany: str(doc.shipper?.companyName), shipperAddress: (doc.shipper?.addressLines || []).join('\n'), shipperContact: str(doc.shipper?.contactName), shipperMobile: str(doc.shipper?.mobile),
    shipToCompany: str(doc.shipTo?.companyName), shipToAddress: (doc.shipTo?.addressLines || []).join('\n'), shipToCountry: str(doc.shipTo?.country), shipToContact: str(doc.shipTo?.contactPerson), shipToMobile: str(doc.shipTo?.mobile), shipToEmail: str(doc.shipTo?.email),
    fromLocation: str(doc.fromLocation), toCountry: str(doc.toCountry), carrierAgent: str(doc.carrierAgent), marksAndNumbers: str(doc.marksAndNumbers),
    cargoType: str(doc.cargoType), packageType: str(doc.packageType), goodsDescription: str(doc.goodsDescription), hsCodeLabel: str(doc.hsCodeLabel),
    transactionType: str(doc.transactionType), paymentMethod: str(doc.paymentMethod), refAcNo: str(doc.refAcNo),
    headerTextOverride: str(doc.headerTextOverride), logoOverride: str(doc.logoOverride), salesInvoiceId: str(doc.salesInvoiceId),
    items: doc.items?.length ? doc.items.map(item => ({ ...emptyItem(), ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, str(value)])) })) as ItemRow[] : [emptyItem()],
    packages: doc.packages?.length ? doc.packages.map(pkg => ({ ...emptyPackage(), ...Object.fromEntries(Object.entries(pkg).map(([key, value]) => [key, str(value)])) })) as PackageRow[] : [emptyPackage()],
  };
}

const toLines = (value: string) => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

/** Form state -> API payload. */
export function toPayload(form: ShippingFormState) {
  return {
    date: form.date, invoiceRefNo: form.invoiceRefNo, orderNumber: form.orderNumber, currency: form.currency,
    importerCode: form.importerCode, agentCode: form.agentCode, repCardNo: form.repCardNo,
    shipper: { companyName: form.shipperCompany, addressLines: toLines(form.shipperAddress), contactName: form.shipperContact, mobile: form.shipperMobile },
    shipTo: { companyName: form.shipToCompany, addressLines: toLines(form.shipToAddress), country: form.shipToCountry, contactPerson: form.shipToContact, mobile: form.shipToMobile, email: form.shipToEmail },
    fromLocation: form.fromLocation, toCountry: form.toCountry, carrierAgent: form.carrierAgent, marksAndNumbers: form.marksAndNumbers,
    cargoType: form.cargoType, packageType: form.packageType, goodsDescription: form.goodsDescription, hsCodeLabel: form.hsCodeLabel,
    transactionType: form.transactionType, paymentMethod: form.paymentMethod, refAcNo: form.refAcNo,
    headerTextOverride: form.headerTextOverride, logoOverride: form.logoOverride, salesInvoiceId: form.salesInvoiceId,
    items: form.items.map(item => ({ ...item, qty: Number(item.qty), unitPrice: Number(item.unitPrice), grossWeightKg: Number(item.grossWeightKg) })),
    packages: form.packages.map(pkg => ({ lengthCm: Number(pkg.lengthCm), widthCm: Number(pkg.widthCm), heightCm: Number(pkg.heightCm), qty: Number(pkg.qty) })),
  };
}

/** Same rules as the API; returns human-readable problems. */
export function validateShippingForm(form: ShippingFormState): string[] {
  const errors: string[] = [];
  const need = (value: string, label: string) => { if (!value.trim()) errors.push(`${label} is required`); };
  need(form.date, 'Date'); need(form.invoiceRefNo, 'Invoice / Ref No.');
  need(form.shipperCompany, 'Shipper company name'); if (!toLines(form.shipperAddress).length) errors.push('Shipper address is required');
  need(form.shipToCompany, 'Ship-to company name'); if (!toLines(form.shipToAddress).length) errors.push('Ship-to address is required');
  need(form.fromLocation, 'From (location)'); need(form.toCountry, 'To (country)');
  need(form.transactionType, 'Transaction type'); need(form.goodsDescription, 'Description of goods');
  need(form.cargoType, 'Type'); need(form.packageType, 'Package type');
  if (form.shipToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.shipToEmail)) errors.push('Ship-to email is not valid');
  if (!form.items.length) errors.push('Add at least one item');
  form.items.forEach((item, index) => {
    const row = `Item ${index + 1}`;
    for (const [key, label] of [['itemCode', 'item code'], ['description', 'description'], ['hsCode', 'HS code'], ['coo', 'COO'], ['inboundRef', 'inbound ref']] as const) {
      if (!item[key].trim()) errors.push(`${row}: ${label} is required`);
    }
    for (const [key, label] of [['qty', 'quantity'], ['unitPrice', 'unit price'], ['grossWeightKg', 'gross weight']] as const) {
      if (!(Number(item[key]) > 0)) errors.push(`${row}: ${label} must be greater than zero`);
    }
  });
  if (!form.packages.length) errors.push('Add at least one package');
  form.packages.forEach((pkg, index) => {
    for (const [key, label] of [['lengthCm', 'length'], ['widthCm', 'width'], ['heightCm', 'height'], ['qty', 'quantity']] as const) {
      if (!(Number(pkg[key]) > 0)) errors.push(`Package ${index + 1}: ${label} must be greater than zero`);
    }
    if (Number(pkg.qty) > 0 && !Number.isInteger(Number(pkg.qty))) errors.push(`Package ${index + 1}: quantity must be a whole number`);
  });
  return errors;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-[#4b5563]">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-[#8a929d]">{hint}</p>}
    </div>
  );
}

const ITEM_COLUMNS: Array<{ key: keyof ItemRow; label: string; width: string; type?: string; placeholder?: string }> = [
  { key: 'itemCode', label: 'Item code *', width: 'w-32' },
  { key: 'description', label: 'Description *', width: 'w-56' },
  { key: 'qty', label: 'Qty *', width: 'w-20', type: 'number' },
  { key: 'serialNo', label: 'Serial no.', width: 'w-28', placeholder: 'N/A if empty' },
  { key: 'unitPrice', label: 'Unit price *', width: 'w-28', type: 'number' },
  { key: 'hsCode', label: 'HS code *', width: 'w-28' },
  { key: 'eccn', label: 'ECCN', width: 'w-24', placeholder: 'N/A if empty' },
  { key: 'coo', label: 'COO *', width: 'w-20' },
  { key: 'inboundRef', label: 'Inbound ref *', width: 'w-36' },
  { key: 'grossWeightKg', label: 'Gross wt (kg) *', width: 'w-28', type: 'number' },
];

export function ShippingInvoiceForm({ value, onChange, companyLogo, companyHeaderText }: {
  value: ShippingFormState;
  onChange: (next: ShippingFormState) => void;
  companyLogo?: string;
  companyHeaderText?: string;
}) {
  const [logoError, setLogoError] = useState('');
  const set = <K extends keyof ShippingFormState>(key: K, next: ShippingFormState[K]) => onChange({ ...value, [key]: next });
  const calc = useMemo(() => computeShipping(toPayload(value) as unknown as ShippingInvoiceInput), [value]);
  const input = (key: keyof ShippingFormState, placeholder?: string) => (
    <Input value={String(value[key])} placeholder={placeholder} onChange={event => set(key, event.target.value as never)} />
  );

  const updateItem = (index: number, key: keyof ItemRow, next: string) => set('items', value.items.map((row, i) => (i === index ? { ...row, [key]: next } : row)));
  const updatePackage = (index: number, key: keyof PackageRow, next: string) => set('packages', value.packages.map((row, i) => (i === index ? { ...row, [key]: next } : row)));

  const readLogo = (file?: File) => {
    setLogoError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setLogoError('Use a PNG or JPEG image.'); return; }
    if (file.size > 1_500_000) { setLogoError('Logo must be 1.5 MB or smaller.'); return; }
    const reader = new FileReader();
    reader.onload = () => set('logoOverride', String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Field label="Date *"><Input type="date" value={value.date} onChange={event => set('date', event.target.value)} /></Field>
          <Field label="Invoice / Ref No. (also D.A. No.) *">{input('invoiceRefNo')}</Field>
          <Field label="Order number">{input('orderNumber')}</Field>
          <Field label="Currency *"><CurrencySelect value={value.currency} onChange={currency => set('currency', currency)} /></Field>
          <Field label="Importer code">{input('importerCode')}</Field>
          <Field label="Agent code">{input('agentCode')}</Field>
          <Field label="Rep card no.">{input('repCardNo')}</Field>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Shipper</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Company name *">{input('shipperCompany')}</Field>
            <Field label="Address (one line per row) *"><Textarea rows={3} value={value.shipperAddress} onChange={event => set('shipperAddress', event.target.value)} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Contact name">{input('shipperContact')}</Field>
              <Field label="Mobile">{input('shipperMobile')}</Field>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ship To</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Company name *">{input('shipToCompany')}</Field>
            <Field label="Address (one line per row) *"><Textarea rows={3} value={value.shipToAddress} onChange={event => set('shipToAddress', event.target.value)} /></Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Country">{input('shipToCountry')}</Field>
              <Field label="Contact person">{input('shipToContact')}</Field>
              <Field label="Mobile">{input('shipToMobile')}</Field>
              <Field label="Email"><Input type="email" value={value.shipToEmail} onChange={event => set('shipToEmail', event.target.value)} /></Field>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Routing &amp; Goods</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <Field label="From (location) *">{input('fromLocation', 'e.g. port / free zone')}</Field>
            <Field label="To (country) *">{input('toCountry')}</Field>
            <Field label="Type (Delivery Advice) *" hint="Package type code shown in the Type column">{input('cargoType', 'e.g. a package code')}</Field>
            <Field label="Package unit *" hint='Printed as "<total packages> <unit>"'>{input('packageType', 'e.g. pallet / carton')}</Field>
            <div className="md:col-span-2"><Field label="Description of goods *">{input('goodsDescription')}</Field></div>
            <Field label="HS code (Delivery Advice)">{input('hsCodeLabel', 'e.g. a code or reference text')}</Field>
            <Field label="Marks & numbers">{input('marksAndNumbers')}</Field>
            <div className="md:col-span-2"><Field label="Carrier's agent">{input('carrierAgent')}</Field></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Transaction &amp; Payment</CardTitle></CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Transaction type *">
              <div className="grid grid-cols-2 gap-2">
                {TRANSACTION_TYPES.map(type => (
                  <label key={type} className="flex items-center gap-2 text-sm text-[#374151]">
                    <input type="radio" name="transactionType" checked={value.transactionType === type} onChange={() => set('transactionType', type)} />
                    {type}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Payment method">
              <Select value={value.paymentMethod || 'NONE'} onValueChange={next => set('paymentMethod', next === 'NONE' ? '' : next)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Not marked</SelectItem>
                  {PAYMENT_METHODS.map(method => <SelectItem key={method} value={method}>{method}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Ref: A/C No.">{input('refAcNo')}</Field>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-[#e5e2dc]">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f8faf9] text-xs uppercase text-[#6b7280]">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  {ITEM_COLUMNS.map(column => <th key={column.key} className="px-2 py-2 text-left font-semibold">{column.label}</th>)}
                  <th className="px-2 py-2 text-right">Line total</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ede8]">
                {value.items.map((item, index) => (
                  <tr key={index}>
                    <td className="px-2 py-1 text-xs text-[#6b7280]">{index + 1}</td>
                    {ITEM_COLUMNS.map(column => (
                      <td key={column.key} className="px-1 py-1">
                        <Input className={`h-8 ${column.width}`} type={column.type || 'text'} min={column.type ? '0' : undefined} step={column.type ? 'any' : undefined}
                          placeholder={column.placeholder} value={item[column.key]} onChange={event => updateItem(index, column.key, event.target.value)} />
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-2 py-1 text-right font-medium">{formatCurrencyValue(value.currency, calc.lines[index]?.lineTotal || 0)}</td>
                    <td className="whitespace-nowrap px-1 py-1">
                      <Button type="button" variant="ghost" size="icon" title="Duplicate row" onClick={() => set('items', [...value.items.slice(0, index + 1), { ...item }, ...value.items.slice(index + 1)])}><Copy className="h-4 w-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" title="Remove row" disabled={value.items.length === 1} onClick={() => set('items', value.items.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set('items', [...value.items, emptyItem()])}><Plus className="mr-2 h-4 w-4" />Add item</Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader><CardTitle>Packages</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-[#e5e2dc]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f8faf9] text-xs uppercase text-[#6b7280]">
                  <tr>
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Length (cm) *</th>
                    <th className="px-2 py-2 text-left">Width (cm) *</th>
                    <th className="px-2 py-2 text-left">Height (cm) *</th>
                    <th className="px-2 py-2 text-left">Qty *</th>
                    <th className="px-2 py-2 text-right">CBM</th>
                    <th className="px-2 py-2 text-right">T.CBM</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0ede8]">
                  {value.packages.map((pkg, index) => (
                    <tr key={index}>
                      <td className="px-2 py-1 text-xs text-[#6b7280]">{index + 1}</td>
                      {(['lengthCm', 'widthCm', 'heightCm', 'qty'] as const).map(key => (
                        <td key={key} className="px-1 py-1"><Input className="h-8 w-28" type="number" min="0" step={key === 'qty' ? '1' : 'any'} value={pkg[key]} onChange={event => updatePackage(index, key, event.target.value)} /></td>
                      ))}
                      <td className="px-2 py-1 text-right">{formatCbm(calc.packages[index]?.rowCbm || 0, 2)}</td>
                      <td className="px-2 py-1 text-right">{formatCbm(calc.packages[index]?.rowTotalCbm || 0, 2)}</td>
                      <td className="whitespace-nowrap px-1 py-1">
                        <Button type="button" variant="ghost" size="icon" title="Duplicate row" onClick={() => set('packages', [...value.packages.slice(0, index + 1), { ...pkg }, ...value.packages.slice(index + 1)])}><Copy className="h-4 w-4" /></Button>
                        <Button type="button" variant="ghost" size="icon" title="Remove row" disabled={value.packages.length === 1} onClick={() => set('packages', value.packages.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => set('packages', [...value.packages, emptyPackage()])}><Plus className="mr-2 h-4 w-4" />Add package row</Button>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader><CardTitle>Calculated (read-only)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Summary label="Total quantity" value={formatQuantity(calc.totals.qty)} />
            <Summary label="Total value" value={formatCurrencyValue(value.currency, calc.totals.value)} strong />
            <Summary label="Total weight" value={`${formatQuantity(calc.totals.weightKg)} KGS`} />
            <Summary label="Total packages" value={`${formatQuantity(calc.totals.packages)} ${value.packageType}`.trim()} />
            <Summary label="Total CBM" value={`${formatCbm(calc.totals.cbm, 4)} (packing list: ${formatCbm(calc.totals.cbm, 2)})`} />
            <Summary label="B/E Ref Nos." value={calc.beRefNos || '-'} />
            <Summary label="Country of origin" value={calc.countryOfOrigin || '-'} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Branding for this invoice (optional)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Header text override" hint={companyHeaderText ? `Company profile: "${companyHeaderText}"` : 'No header text set in the company profile'}>
            {input('headerTextOverride', 'Leave empty to use the company profile')}
          </Field>
          <Field label="Logo override" hint={companyLogo ? 'Leave empty to use the company profile logo' : 'No logo set in the company profile'}>
            <div className="flex items-center gap-3">
              {value.logoOverride ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={value.logoOverride} alt="Logo override" className="h-12 max-w-[140px] rounded border border-[#e5e2dc] object-contain" />
              ) : companyLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={companyLogo} alt="Company logo" className="h-12 max-w-[140px] rounded border border-dashed border-[#e5e2dc] object-contain opacity-60" />
              ) : null}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#e5e2dc] px-3 py-1.5 text-sm hover:bg-[#f8faf9]">
                <ImagePlus className="h-4 w-4" />Upload PNG/JPEG
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={event => readLogo(event.target.files?.[0])} />
              </label>
              {value.logoOverride && <Button type="button" variant="ghost" size="sm" onClick={() => set('logoOverride', '')}><X className="mr-1 h-4 w-4" />Remove</Button>}
            </div>
            {logoError && <p className="text-xs text-[#c3423f]">{logoError}</p>}
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[#6b7280]">{label}</span>
      <span className={`text-right ${strong ? 'font-semibold text-[#1f2937]' : 'font-medium text-[#374151]'} break-all`}>{value}</span>
    </div>
  );
}
