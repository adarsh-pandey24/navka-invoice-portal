import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Globe,
  IndianRupee,
  Pencil,
  Plus,
  Search,
  Wallet,
} from 'lucide-react';
import apiClient from '../services/api';
import { Invoice, LedgerPayment, PaginationMeta } from '../types';
import { formatCurrency, formatDate } from '../utils/format';
import { downloadFile } from '../utils/pdf';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';
import { StatCard } from '../components/StatCard/StatCard';
import { Field, Modal, inputClass, primaryButton, secondaryButton } from '../components/UI/Modal';
import { useAuth } from '../context/AuthContext';

const METHODS = ['ONLINE', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];
const OFFLINE_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];
const SOURCES = ['ONLINE', 'OFFLINE'];
const STATUSES = ['COMPLETED', 'PENDING', 'FAILED', 'REFUNDED'];
const FILTER_KEYS = ['search', 'source', 'method', 'status', 'startDate', 'endDate', 'minAmount', 'maxAmount'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const methodLabel = (m: string) => m.replace('_', ' ');
const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Summary {
  totalReceived: number;
  onlineReceived: number;
  offlineReceived: number;
  onlineCount: number;
  offlineCount: number;
}

export const PaymentsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();

  const [payments, setPayments] = useState<LedgerPayment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta>({ currentPage: 1, limit: 20, totalRecords: 0, totalPages: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const [filters, setFilters] = useState<Record<FilterKey, string>>(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || ''])) as Record<FilterKey, string>
  );
  const [recordFor, setRecordFor] = useState<string | null | undefined>(undefined); // undefined = closed
  const [editing, setEditing] = useState<LedgerPayment | null>(null);

  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const activeFilters = (): Record<string, string> => {
    const params: Record<string, string> = {};
    for (const k of FILTER_KEYS) {
      const v = searchParams.get(k);
      if (v) params[k] = v;
    }
    return params;
  };

  const fetchPayments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/payments', { params: { page, limit: 20, ...activeFilters() } });
      setPayments(res.data.payments || []);
      setSummary(res.data.summary);
      setPagination(res.data.pagination);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error fetching payments.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPayments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // /payments?record=<invoiceId> opens the record modal for that invoice (from invoice detail).
  useEffect(() => {
    const record = searchParams.get('record');
    if (record && isAdmin) setRecordFor(record);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = (nextPage = 1) => {
    const next = new URLSearchParams();
    next.set('page', String(nextPage));
    for (const k of FILTER_KEYS) if (filters[k].trim()) next.set(k, filters[k].trim());
    setSearchParams(next);
  };

  const resetFilters = () => {
    setFilters(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Record<FilterKey, string>);
    setSearchParams({ page: '1' });
  };

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 5000);
  };

  const exportLedger = async (format: 'csv' | 'excel') => {
    setExporting(format);
    try {
      await downloadFile('/payments/export', { format, ...activeFilters() }, `navka-payments.${format === 'csv' ? 'csv' : 'xlsx'}`);
    } catch {
      flash('Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const setFilter = (key: FilterKey, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Payments</h1>
          <p className="text-sm text-slate-500 mt-0.5">Unified ledger of Shopify online payments and offline receipts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => exportLedger('csv')} disabled={!!exporting} className={secondaryButton}>
            <FileText className="w-4 h-4" />
            {exporting === 'csv' ? 'Exporting…' : 'CSV'}
          </button>
          <button onClick={() => exportLedger('excel')} disabled={!!exporting} className={secondaryButton}>
            <FileSpreadsheet className="w-4 h-4" />
            {exporting === 'excel' ? 'Exporting…' : 'Excel'}
          </button>
          {isAdmin && (
            <button onClick={() => setRecordFor(null)} className={primaryButton}>
              <Plus className="w-4 h-4" />
              Record Offline Payment
            </button>
          )}
        </div>
      </div>

      {notice && <div className="bg-slate-50 border border-slate-200 text-slate-700 p-3 rounded-xl text-sm">{notice}</div>}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </span>
          <button onClick={fetchPayments} className="text-xs font-semibold underline">
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Received"
          value={summary ? formatCurrency(summary.totalReceived) : '...'}
          subtext="Completed payments matching filters"
          icon={IndianRupee}
          variant="emerald"
        />
        <StatCard
          title="Online (Shopify)"
          value={summary ? formatCurrency(summary.onlineReceived) : '...'}
          subtext={summary ? `${summary.onlineCount} record(s)` : undefined}
          icon={Globe}
          variant="blue"
        />
        <StatCard
          title="Offline"
          value={summary ? formatCurrency(summary.offlineReceived) : '...'}
          subtext={summary ? `${summary.offlineCount} record(s)` : undefined}
          icon={Wallet}
          variant="indigo"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <Field label="Search">
            <div className="mt-1 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Invoice #, customer, reference"
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-slate-800"
              />
            </div>
          </Field>
          {(
            [
              ['source', 'Source', SOURCES],
              ['method', 'Method', METHODS],
              ['status', 'Status', STATUSES],
            ] as const
          ).map(([key, label, options]) => (
            <Field key={key} label={label}>
              <select value={filters[key]} onChange={(e) => setFilter(key, e.target.value)} className={inputClass()}>
                <option value="">All</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {methodLabel(o)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <Field label="From date">
            <input type="date" value={filters.startDate} onChange={(e) => setFilter('startDate', e.target.value)} className={inputClass()} />
          </Field>
          <Field label="To date">
            <input type="date" value={filters.endDate} onChange={(e) => setFilter('endDate', e.target.value)} className={inputClass()} />
          </Field>
          <Field label="Min amount">
            <input type="number" min={0} value={filters.minAmount} onChange={(e) => setFilter('minAmount', e.target.value)} className={inputClass()} />
          </Field>
          <Field label="Max amount">
            <input type="number" min={0} value={filters.maxAmount} onChange={(e) => setFilter('maxAmount', e.target.value)} className={inputClass()} />
          </Field>
        </div>
        <div className="flex gap-2">
          <button onClick={() => applyFilters()} className={primaryButton}>
            Apply filters
          </button>
          <button onClick={resetFilters} className={secondaryButton}>
            Reset
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 text-xs uppercase font-semibold">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Invoice</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Source</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Recorded by</th>
                {isAdmin && <th className="py-3 px-4 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center text-slate-400">
                    Loading payments...
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-16 text-center">
                    <CreditCard className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-600">No payments found</p>
                    <p className="text-xs text-slate-400 mt-1">Try adjusting the filters.</p>
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p._id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 text-slate-600">{formatDate(p.paymentDate)}</td>
                    <td className="py-3 px-4 font-semibold">
                      {p.invoiceId ? (
                        <Link to={`/invoices/${p.invoiceId._id}`} className="text-slate-900 hover:underline">
                          {p.invoiceId.invoiceNumber}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-800">{p.invoiceId?.customer?.name || '—'}</td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-900">{formatCurrency(p.amount)}</td>
                    <td className="py-3 px-4 text-slate-700">{methodLabel(p.paymentMethod)}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                          p.paymentSource === 'ONLINE'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}
                      >
                        {p.paymentSource}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge label={p.paymentStatus} />
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-xs break-all">{p.referenceId || '—'}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {p.recordedBy?.name || (p.paymentSource === 'ONLINE' ? 'Shopify' : '—')}
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-4 text-right">
                        {p.paymentSource === 'OFFLINE' ? (
                          <button
                            onClick={() => setEditing(p)}
                            title="Edit payment"
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Synced</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-slate-500">
            Page {pagination.currentPage} of {pagination.totalPages} · {pagination.totalRecords} record(s)
          </p>
          <div className="flex gap-2">
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

      {isAdmin && recordFor !== undefined && (
        <RecordPaymentModal
          initialInvoiceId={recordFor}
          onClose={() => setRecordFor(undefined)}
          onSaved={(message) => {
            setRecordFor(undefined);
            flash(message);
            fetchPayments();
          }}
        />
      )}
      {isAdmin && editing && (
        <EditPaymentModal
          payment={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            flash(message);
            fetchPayments();
          }}
        />
      )}
    </div>
  );
};

interface InvoiceOption {
  invoice: Invoice;
  balanceDue: number;
}

const RecordPaymentModal: React.FC<{
  initialInvoiceId: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ initialInvoiceId, onClose, onSaved }) => {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Invoice[]>([]);
  const [selected, setSelected] = useState<InvoiceOption | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayInput());
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [referenceId, setReferenceId] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectInvoice = async (id: string) => {
    try {
      const res = await apiClient.get(`/invoices/${id}`);
      const balanceDue: number = res.data.summary.balanceDue;
      setSelected({ invoice: res.data.invoice, balanceDue });
      setAmount(balanceDue > 0 ? String(balanceDue) : '');
      setServerError(null);
    } catch (err: any) {
      setServerError(err.response?.data?.message || 'Could not load invoice.');
    }
  };

  useEffect(() => {
    if (initialInvoiceId) selectInvoice(initialInvoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoiceId]);

  // Only active invoices with money still due can receive payments.
  useEffect(() => {
    if (selected) return;
    const t = setTimeout(async () => {
      try {
        const res = await apiClient.get('/invoices', {
          params: { paymentStatus: 'PENDING,PARTIAL,FAILED', invoiceStatus: 'ACTIVE', search: query || undefined, limit: 10 },
        });
        setOptions(res.data.invoices || []);
      } catch {
        setOptions([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, selected]);

  const save = async () => {
    const e: Record<string, string> = {};
    const value = Number(amount);
    if (!selected) e.invoice = 'Select an invoice';
    if (!Number.isFinite(value) || value <= 0) e.amount = 'Enter an amount greater than zero';
    else if (selected && value > selected.balanceDue) e.amount = `Cannot exceed balance due (${formatCurrency(selected.balanceDue)})`;
    if (!paymentDate) e.paymentDate = 'Required';
    else if (paymentDate > todayInput()) e.paymentDate = 'Cannot be in the future';
    if (['CHEQUE', 'BANK_TRANSFER'].includes(paymentMethod) && !referenceId.trim())
      e.referenceId = 'Cheque number / UTR is required';
    setErrors(e);
    if (Object.keys(e).length || !selected) return;

    setSaving(true);
    setServerError(null);
    try {
      const res = await apiClient.post('/payments', {
        invoiceId: selected.invoice._id,
        amount: value,
        paymentDate,
        paymentMethod,
        referenceId: referenceId.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSaved(`Payment recorded. ${selected.invoice.invoiceNumber} is now ${res.data.updatedInvoiceStatus}.`);
    } catch (err: any) {
      setServerError(err.response?.data?.message || 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Record Offline Payment"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} className={primaryButton}>
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {serverError && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{serverError}</p>}
        {selected ? (
          <div className="border border-slate-200 rounded-lg p-3 flex items-start justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{selected.invoice.invoiceNumber}</p>
              <p className="text-slate-600">{selected.invoice.customer?.name}</p>
              <p className="text-xs text-slate-500 mt-1">
                Total {formatCurrency(selected.invoice.grandTotal)} · Balance due{' '}
                <span className="font-semibold text-slate-900">{formatCurrency(selected.balanceDue)}</span>
              </p>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs font-semibold underline text-slate-600">
              Change
            </button>
          </div>
        ) : (
          <Field label="Invoice (unpaid or partial)" required error={errors.invoice}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invoice # or customer"
              className={inputClass(errors.invoice)}
              autoFocus
            />
            <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {options.length === 0 ? (
                <p className="p-3 text-xs text-slate-400">No unpaid invoices found.</p>
              ) : (
                options.map((inv) => (
                  <button
                    type="button"
                    key={inv._id}
                    onClick={() => selectInvoice(inv._id)}
                    className="w-full text-left p-2.5 hover:bg-slate-50 flex justify-between gap-3 text-sm"
                  >
                    <span>
                      <span className="font-semibold text-slate-900">{inv.invoiceNumber}</span>
                      <span className="text-slate-500"> · {inv.customer?.name}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      {formatCurrency(inv.grandTotal)}
                      <StatusBadge label={inv.paymentStatus} />
                    </span>
                  </button>
                ))
              )}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Amount (₹)" required error={errors.amount}>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass(errors.amount)} />
          </Field>
          <Field label="Payment date" required error={errors.paymentDate}>
            <input
              type="date"
              max={todayInput()}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className={inputClass(errors.paymentDate)}
            />
          </Field>
          <Field label="Method" required>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass()}>
              {OFFLINE_METHODS.map((m) => (
                <option key={m} value={m}>
                  {methodLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Reference (UTR / cheque no.)"
            required={['CHEQUE', 'BANK_TRANSFER'].includes(paymentMethod)}
            error={errors.referenceId}
          >
            <input value={referenceId} maxLength={100} onChange={(e) => setReferenceId(e.target.value)} className={inputClass(errors.referenceId)} />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <textarea value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} className={inputClass()} />
          </Field>
        </div>
        <p className="text-xs text-slate-500">UPI, NEFT and RTGS receipts: use Bank Transfer with the UTR as reference.</p>
      </div>
    </Modal>
  );
};

const EditPaymentModal: React.FC<{
  payment: LedgerPayment;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ payment, onClose, onSaved }) => {
  const [referenceId, setReferenceId] = useState(payment.referenceId || '');
  const [notes, setNotes] = useState(payment.notes || '');
  const [paymentStatus, setPaymentStatus] = useState<string>(payment.paymentStatus);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setServerError(null);
    try {
      const res = await apiClient.put(`/payments/${payment._id}`, { referenceId, notes, paymentStatus });
      onSaved(`Payment updated. Invoice is now ${res.data.updatedInvoiceStatus}.`);
    } catch (err: any) {
      setServerError(err.response?.data?.message || 'Could not update payment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Edit payment · ${formatCurrency(payment.amount)}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={secondaryButton}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} className={primaryButton}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {serverError && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{serverError}</p>}
        <p className="text-sm text-slate-600">
          {payment.invoiceId?.invoiceNumber} · {methodLabel(payment.paymentMethod)} · {formatDate(payment.paymentDate)}
        </p>
        <Field label="Status">
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className={inputClass()}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-slate-500">Only COMPLETED payments count toward the invoice. Use FAILED for a bounced cheque.</p>
        <Field label="Reference">
          <input value={referenceId} maxLength={100} onChange={(e) => setReferenceId(e.target.value)} className={inputClass()} />
        </Field>
        <Field label="Notes">
          <textarea value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} className={inputClass()} />
        </Field>
      </div>
    </Modal>
  );
};
