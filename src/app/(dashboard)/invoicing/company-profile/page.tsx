'use client';

import { useEffect, useState } from 'react';
import { ImagePlus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import api from '@/lib/api';
import { showApiError, showApiSuccess } from '@/lib/apiError';
import { loadCompanyProfile } from '@/components/invoicing/shipping/shippingApi';

type ProfileForm = { companyName: string; headerText: string; logo: string; shipperAddress: string; shipperContactName: string; shipperMobile: string };

export default function CompanyProfilePage() {
  const [form, setForm] = useState<ProfileForm>({ companyName: '', headerText: '', logo: '', shipperAddress: '', shipperContactName: '', shipperMobile: '' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [logoError, setLogoError] = useState('');

  useEffect(() => {
    loadCompanyProfile().then(profile => {
      setForm({
        companyName: profile.companyName || '', headerText: profile.headerText || '', logo: profile.logo || '',
        shipperAddress: (profile.shipperAddressLines || []).join('\n'), shipperContactName: profile.shipperContactName || '', shipperMobile: profile.shipperMobile || '',
      });
      setIsLoading(false);
    });
  }, []);

  const readLogo = (file?: File) => {
    setLogoError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { setLogoError('Use a PNG or JPEG image.'); return; }
    if (file.size > 1_500_000) { setLogoError('Logo must be 1.5 MB or smaller.'); return; }
    const reader = new FileReader();
    reader.onload = () => setForm(prev => ({ ...prev, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await api.put('/invoicing/company-profile', {
        companyName: form.companyName, headerText: form.headerText, logo: form.logo,
        shipperAddressLines: form.shipperAddress.split(/\r?\n/).map(line => line.trim()).filter(Boolean),
        shipperContactName: form.shipperContactName, shipperMobile: form.shipperMobile,
      });
      showApiSuccess('Company profile saved');
    } catch (err) {
      showApiError(err, 'Failed to save company profile');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-md bg-[#ece9e4]" />)}</div>;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[#1f2937]">Company Profile</h1>
        <p className="text-sm text-[#6b7280]">Logo and header line printed on shipping invoice PDFs, plus default shipper details for new shipping invoices. Each invoice can override the logo and header text.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Branding</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Logo (PNG or JPEG, max 1.5 MB)</Label>
            <div className="flex items-center gap-3">
              {form.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.logo} alt="Company logo" className="h-16 max-w-[200px] rounded border border-[#e5e2dc] object-contain" />
              ) : <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed border-[#d9d4cc] text-xs text-[#8a929d]">No logo</div>}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#e5e2dc] px-3 py-1.5 text-sm hover:bg-[#f8faf9]">
                <ImagePlus className="h-4 w-4" />Upload
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={event => readLogo(event.target.files?.[0])} />
              </label>
              {form.logo && <Button variant="ghost" size="sm" onClick={() => setForm(prev => ({ ...prev, logo: '' }))}><X className="mr-1 h-4 w-4" />Remove</Button>}
            </div>
            {logoError && <p className="text-xs text-[#c3423f]">{logoError}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Header text (printed under the logo on the Delivery Advice)</Label>
            <Input value={form.headerText} placeholder="e.g. city, country" onChange={event => setForm(prev => ({ ...prev, headerText: event.target.value }))} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Default shipper (pre-fills new shipping invoices)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2"><Label>Company name</Label><Input value={form.companyName} onChange={event => setForm(prev => ({ ...prev, companyName: event.target.value }))} /></div>
          <div className="space-y-1.5 md:col-span-2"><Label>Address (one line per row)</Label><Textarea rows={3} value={form.shipperAddress} onChange={event => setForm(prev => ({ ...prev, shipperAddress: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Contact name</Label><Input value={form.shipperContactName} onChange={event => setForm(prev => ({ ...prev, shipperContactName: event.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Mobile</Label><Input value={form.shipperMobile} onChange={event => setForm(prev => ({ ...prev, shipperMobile: event.target.value }))} /></div>
        </CardContent>
      </Card>
      <div className="flex justify-end"><Button onClick={save} disabled={isSaving}><Save className="mr-2 h-4 w-4" />{isSaving ? 'Saving...' : 'Save profile'}</Button></div>
    </div>
  );
}
