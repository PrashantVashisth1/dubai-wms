'use client';

import toast from 'react-hot-toast';
import api from '@/lib/api';
import { showApiError } from '@/lib/apiError';

export type CompanyProfile = {
  companyName?: string;
  headerText?: string;
  logo?: string;
  shipperAddressLines?: string[];
  shipperContactName?: string;
  shipperMobile?: string;
};

export async function loadCompanyProfile(): Promise<CompanyProfile> {
  try {
    const res = await api.get('/invoicing/company-profile');
    return res.data?.data || {};
  } catch (err) {
    showApiError(err, 'Failed to load company profile');
    return {};
  }
}

/** Fetches the generated PDF and opens it (preview) or saves it (download). */
export async function openShippingPdf(id: string, refNo: string, mode: 'open' | 'download') {
  try {
    const res = await api.get(`/invoicing/shipping-invoices/${id}/pdf`, { params: { download: mode === 'download' ? 'true' : undefined }, responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
    if (mode === 'download') {
      const link = document.createElement('a');
      link.href = url;
      link.download = `Shipping-Invoice-${refNo.replace(/[^A-Za-z0-9._-]+/g, '_')}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      window.open(url, '_blank');
    }
    window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    const blob = (err as { response?: { data?: unknown } })?.response?.data;
    if (blob instanceof Blob) {
      try {
        toast.error(JSON.parse(await blob.text())?.message || 'Failed to generate PDF');
        return;
      } catch {
        // fall through
      }
    }
    showApiError(err, 'Failed to generate PDF');
  }
}
