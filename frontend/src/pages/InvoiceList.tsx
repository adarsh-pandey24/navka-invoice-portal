import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Download,
  Eye,
  FileText,
  Printer,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Plus,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react';
import apiClient from '../services/api';
import { Invoice, PaymentStatus, InvoiceStatus } from '../types';
import { formatCurrency, formatDate } from '../utils/format';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { downloadInvoicePdf } from '../utils/pdf';

interface PaginationMeta {
  currentPage: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
}

const PAYMENT_STATUSES: Array<PaymentStatus | ''> = ['', 'PAID', 'PENDING', 'PARTIAL', 'FAILED', 'REFUNDED'];
const INVOICE_STATUSES: Array<InvoiceStatus | ''> = ['', 'ACTIVE', 'CANCELLED'];

// Must match the sortable fields accepted by GET /api/invoices.
type SortField = 'invoiceNumber' | 'invoiceDate' | 'grandTotal' | 'totalGST';
type SortOrder = 'asc' | 'desc';
const SORT_FIELDS: SortField[] = ['invoiceNumber', 'invoiceDate', 'grandTotal', 'totalGST'];

const toPositiveInt = (raw: string | null, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const InvoiceListPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta>({
    currentPage: 1,
    limit: 20,
    totalRecords: 0,
    totalPages: 1,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [customer, setCustomer] = useState(searchParams.get('customer') || '');
  const [hsnSac, setHsnSac] = useState(searchParams.get('hsnSac') || '');
  const [paymentStatus, setPaymentStatus] = useState(searchParams.get('paymentStatus') || '');
  const [invoiceStatus, setInvoiceStatus] = useState(searchParams.get('invoiceStatus') || '');
  const [month, setMonth] = useState(searchParams.get('month') || '');
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || '');
  const [minAmount, setMinAmount] = useState(searchParams.get('minAmount') || '');
  const [maxAmount, setMaxAmount] = useState(searchParams.get('maxAmount') || '');
  const page = toPositiveInt(searchParams.get('page'), 1);
  const limit = toPositiveInt(searchParams.get('limit'), 20);
  const sortByParam = searchParams.get('sortBy') as SortField | null;
  const sortBy: SortField = sortByParam && SORT_FIELDS.includes(sortByParam) ? sortByParam : 'invoiceDate';
  const sortOrder: SortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

  const fetchInvoices = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page, limit, sortBy, sortOrder };
      const searchVal = searchParams.get('search');
      const customerVal = searchParams.get('customer');
      const hsnVal = searchParams.get('hsnSac');
      const payVal = searchParams.get('paymentStatus');
      const invVal = searchParams.get('invoiceStatus');
      const monthVal = searchParams.get('month');
      const startVal = searchParams.get('startDate');
      const endVal = searchParams.get('endDate');
      const minVal = searchParams.get('minAmount');
      const maxVal = searchParams.get('maxAmount');

      if (searchVal) params.search = searchVal;
      if (customerVal) params.customer = customerVal;
      if (hsnVal) params.hsnSac = hsnVal;
      if (payVal) params.paymentStatus = payVal;
      if (invVal) params.invoiceStatus = invVal;
      if (monthVal) params.month = monthVal;
      if (startVal) params.startDate = startVal;
      if (endVal) params.endDate = endVal;
      if (minVal) params.minAmount = minVal;
      if (maxVal) params.maxAmount = maxVal;

      const res = await apiClient.get('/invoices', { params });
      if (res.data?.success) {
        setInvoices(res.data.invoices || []);
        setPagination(res.data.pagination);
      } else {
        setError('Failed to load invoices.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error fetching invoices.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const applyFilters = (
    pageOverride?: number,
    sort: { sortBy: SortField; sortOrder: SortOrder } = { sortBy, sortOrder }
  ) => {
    const next = new URLSearchParams();
    next.set('page', String(pageOverride || 1));
    next.set('limit', String(limit));
    next.set('sortBy', sort.sortBy);
    next.set('sortOrder', sort.sortOrder);
    if (search.trim()) next.set('search', search.trim());
    if (customer.trim()) next.set('customer', customer.trim());
    if (hsnSac.trim()) next.set('hsnSac', hsnSac.trim());
    if (paymentStatus) next.set('paymentStatus', paymentStatus);
    if (invoiceStatus) next.set('invoiceStatus', invoiceStatus);
    if (month) next.set('month', month);
    if (startDate) next.set('startDate', startDate);
    if (endDate) next.set('endDate', endDate);
    if (minAmount) next.set('minAmount', minAmount);
    if (maxAmount) next.set('maxAmount', maxAmount);
    setSearchParams(next);
  };

  const resetFilters = () => {
    setSearch('');
    setCustomer('');
    setHsnSac('');
    setPaymentStatus('');
    setInvoiceStatus('');
    setMonth('');
    setStartDate('');
    setEndDate('');
    setMinAmount('');
    setMaxAmount('');
    setSearchParams({ page: '1', limit: String(limit), sortBy, sortOrder });
  };

  const toggleSort = (field: SortField) => {
    const nextOrder: SortOrder = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc';
    applyFilters(1, { sortBy: field, sortOrder: nextOrder });
  };

  const sortHeader = (field: SortField, label: string, alignRight = false) => {
    const active = sortBy === field;
    const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th
        className={`py-3 px-4 ${alignRight ? 'text-right' : ''}`}
        aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className={`inline-flex items-center gap-1 uppercase hover:text-slate-900 ${active ? 'text-slate-900' : ''}`}
        >
          {label}
          <Icon className={`w-3 h-3 ${active ? '' : 'text-slate-400'}`} />
        </button>
      </th>
    );
  };

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const downloadPdf = async (inv: Invoice) => {
    setDownloadingId(inv._id);
    try {
      await downloadInvoicePdf(inv._id, inv.invoiceNumber);
    } catch {
      setNotice(`Could not download PDF for ${inv.invoiceNumber}. Please try again.`);
      setTimeout(() => setNotice(null), 4000);
    } finally {
      setDownloadingId(null);
    }
  };

  const printInvoice = (id: string) => {
    window.open(`/invoices/${id}?print=1`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Invoices</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Search, filter, and review GST invoices from Shopify and manual billing.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-slate-500">
            {pagination.totalRecords} record{pagination.totalRecords === 1 ? '' : 's'}
          </p>
          {/* CA is view-only: invoice creation is Admin-only (also enforced by route + API). */}
          {isAdmin && (
            <Link
              to="/invoices/create"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800"
            >
              <Plus className="w-4 h-4" />
              Create Invoice
            </Link>
          )}
        </div>
      </div>

      {notice && (
        <div className="bg-slate-50 border border-slate-200 text-slate-700 p-3 rounded-xl text-sm">{notice}</div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </span>
          <button onClick={fetchInvoices} className="text-xs font-semibold underline hover:no-underline">
            Retry
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Search</span>
            <div className="mt-1 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Invoice #, order, customer, product, HSN"
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-slate-800"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</span>
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-slate-800"
              placeholder="Customer name"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">HSN / SAC</span>
            <input
              value={hsnSac}
              onChange={(e) => setHsnSac(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-slate-800"
              placeholder="e.g. 844332"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payment status</span>
            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none bg-white"
            >
              {PAYMENT_STATUSES.map((s) => (
                <option key={s || 'all'} value={s}>
                  {s || 'All'}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Invoice status</span>
            <select
              value={invoiceStatus}
              onChange={(e) => setInvoiceStatus(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none bg-white"
            >
              {INVOICE_STATUSES.map((s) => (
                <option key={s || 'all'} value={s}>
                  {s || 'All'}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Month</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">From date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">To date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Min amount</span>
            <input
              type="number"
              min={0}
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none"
              placeholder="₹"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Max amount</span>
            <input
              type="number"
              min={0}
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none"
              placeholder="₹"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => applyFilters()}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800"
          >
            Apply filters
          </button>
          <button
            onClick={resetFilters}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 text-xs uppercase font-semibold">
                {sortHeader('invoiceNumber', 'Invoice Number')}
                <th className="py-3 px-4">Shopify Order ID</th>
                {sortHeader('invoiceDate', 'Date')}
                <th className="py-3 px-4">Customer</th>
                {sortHeader('grandTotal', 'Total Amount', true)}
                {sortHeader('totalGST', 'Total GST', true)}
                <th className="py-3 px-4">Payment Status</th>
                <th className="py-3 px-4">Invoice Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400 text-sm">
                    Loading invoices...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-600">No invoices found</p>
                    <p className="text-xs text-slate-400 mt-1">Try adjusting search or filters.</p>
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv._id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-semibold text-slate-900">{inv.invoiceNumber}</td>
                    <td className="py-3 px-4 text-slate-600">{inv.shopifyOrderId || inv.shopifyOrderNumber || '—'}</td>
                    <td className="py-3 px-4 text-slate-600">{formatDate(inv.invoiceDate)}</td>
                    <td className="py-3 px-4 text-slate-800">{inv.customer?.name || '—'}</td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">{formatCurrency(inv.grandTotal)}</td>
                    <td className="py-3 px-4 text-right text-indigo-700 font-medium">{formatCurrency(inv.totalGST)}</td>
                    <td className="py-3 px-4">
                      <StatusBadge label={inv.paymentStatus} kind="payment" />
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge label={inv.invoiceStatus} kind="invoice" />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/invoices/${inv._id}`}
                          title="View"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          title="Download PDF"
                          onClick={() => downloadPdf(inv)}
                          disabled={downloadingId === inv._id}
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md disabled:opacity-40"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          title="Print"
                          onClick={() => printInvoice(inv._id)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-slate-500">
            Page {pagination.currentPage} of {pagination.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={pagination.currentPage <= 1 || isLoading}
              onClick={() => applyFilters(pagination.currentPage - 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>
            <button
              disabled={pagination.currentPage >= pagination.totalPages || isLoading}
              onClick={() => applyFilters(pagination.currentPage + 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
