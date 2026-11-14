'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, Download, FileText, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { showApiError, showApiSuccess } from '@/lib/apiError';
import {
  ShippingInvoiceForm, emptyShippingForm, toFormState, toPayload, validateShippingForm, type ShippingFormState,
} from './ShippingInvoiceForm';
import { loadCompanyProfile, openShippingPdf, type CompanyProfile } from './shippingApi';

/** Create (no `id`) or edit (with `id`) a shipping invoice. */
export function ShippingInvoiceEditor({ id }: { id?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<ShippingFormState>(emptyShippingForm);
  const [profile, setProfile] = useState<CompanyProfile>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [prefillNote, setPrefillNote] = useState('');
  const [savedRef, setSavedRef] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      const company = await loadCompanyProfile();
      if (!active) return;
      setProfile(company);
      try {
        if (id) {
          const res = await api.get(`/invoicing/shipping-invoices/${id}`);
          if (!active) return;
          setForm(toFormState(res.data?.data || {}));
          setSavedRef(res.data?.data?.invoiceRefNo || '');
        } else {
          const fromSales = new URLSearchParams(window.location.search).get('fromSalesInvoice');
          if (fromSales) {
            const res = await api.get(`/invoicing/shipping-invoices/prefill/from-sales-invoice/${fromSales}`);
            if (!active) return;
            setForm(toFormState(res.data?.data || {}));
            setPrefillNote('Pre-filled from the sales invoice. Complete HS codes, country of origin, inbound refs, weights and packages before saving.');
          } else {
            setForm({
              ...emptyShippingForm(),
              shipperCompany: company.companyName || '',
              shipperAddress: (company.shipperAddressLines || []).join('\n'),
              shipperContact: company.shipperContactName || '',
              shipperMobile: company.shipperMobile || '',
            });
          }
        }
      } catch (err) {
        if (!active) return;
        setLoadError((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to load the shipping invoice');
        showApiError(err, 'Failed to load the shipping invoice');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  const save = async () => {
    if (isSaving) return;
    const problems = validateShippingForm(form);
    setErrors(problems);
    if (problems.length) {
      toast.error(problems[0]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setIsSaving(true);
    try {
      const payload = toPayload(form);
      const res = id ? await api.put(`/invoicing/shipping-invoices/${id}`, payload) : await api.post('/invoicing/shipping-invoices', payload);
      const saved = res.data?.data;
      showApiSuccess(`Shipping invoice ${saved?.invoiceRefNo || ''} saved`);
      if (!id && saved?.id) router.push(`/invoicing/shipping-invoices/${saved.id}`);
      else { setForm(toFormState(saved || {})); setSavedRef(saved?.invoiceRefNo || ''); }
    } catch (err) {
      const details = (err as { response?: { data?: { details?: Array<{ message: string }> } } })?.response?.data?.details;
      if (Array.isArray(details)) setErrors(details.map(detail => detail.message));
      showApiError(err, 'Failed to save shipping invoice');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-md bg-[#ece9e4]" />)}</div>;
  if (loadError && id) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild><Link href="/invoicing/shipping-invoices"><ArrowLeft className="mr-2 h-4 w-4" />Back</Link></Button>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-[52px] z-20 -mx-4 border-b border-[#dfe3e8] bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1"><Link href="/invoicing/shipping-invoices"><ArrowLeft className="mr-2 h-4 w-4" />Shipping invoices</Link></Button>
            <h1 className="text-xl font-semibold text-[#1f2937]">{id ? `Shipping Invoice ${savedRef}` : 'New Shipping Invoice'}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {id && (
              <>
                <Button variant="outline" onClick={() => openShippingPdf(id, savedRef, 'open')}><FileText className="mr-2 h-4 w-4" />Preview PDF</Button>
                <Button variant="outline" onClick={() => openShippingPdf(id, savedRef, 'download')}><Download className="mr-2 h-4 w-4" />Download PDF</Button>
              </>
            )}
            <Button onClick={save} disabled={isSaving}><Save className="mr-2 h-4 w-4" />{isSaving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </div>

      {id && <p className="text-xs text-[#6b7280]">The PDF is generated from the last saved version. Save changes before downloading.</p>}
      {prefillNote && <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{prefillNote}</div>}
      {!profile.logo && !form.logoOverride && (
        <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />No company logo is set, so the PDF will print without a logo.</span>
          <Link href="/invoicing/company-profile" className="font-semibold underline">Set up company profile</Link>
        </div>
      )}
      {errors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-1 font-semibold">Please fix {errors.length} problem{errors.length === 1 ? '' : 's'}:</p>
          <ul className="list-disc pl-5">{errors.slice(0, 12).map(error => <li key={error}>{error}</li>)}</ul>
          {errors.length > 12 && <p className="mt-1">…and {errors.length - 12} more.</p>}
        </div>
      )}

      <ShippingInvoiceForm value={form} onChange={setForm} companyLogo={profile.logo} companyHeaderText={profile.headerText} />

      <div className="flex justify-end gap-2 pb-6">
        <Button variant="outline" asChild><Link href="/invoicing/shipping-invoices">Cancel</Link></Button>
        <Button onClick={save} disabled={isSaving}><Save className="mr-2 h-4 w-4" />{isSaving ? 'Saving...' : 'Save'}</Button>
      </div>
    </div>
  );
}
