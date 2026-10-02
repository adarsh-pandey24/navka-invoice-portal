import { PaymentStatus, InvoiceStatus } from '../types';

export const formatCurrency = (val: number): string =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(val || 0);

export const formatDate = (value?: string): string => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const paymentStatusClass = (status: PaymentStatus | string): string => {
  switch (status) {
    case 'PAID':
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'PENDING':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'PARTIAL':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    case 'FAILED':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'REFUNDED':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
};

export const invoiceStatusClass = (status: InvoiceStatus | string): string => {
  switch (status) {
    case 'ACTIVE':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'CANCELLED':
      return 'bg-slate-100 text-slate-600 border-slate-200';
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
};

export const formatAddress = (addr?: {
  street?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}): string => {
  if (!addr) return '—';
  const parts = [addr.street, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
};
