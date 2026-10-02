import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  IndianRupee,
  Receipt,
  RotateCcw,
  Wallet,
  Clock,
  FileDown,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import apiClient from '../services/api';
import { formatCurrency, formatDate } from '../utils/format';
import { downloadFile } from '../utils/pdf';
import { StatCard } from '../components/StatCard/StatCard';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';
import { Field, inputClass, primaryButton, secondaryButton } from '../components/UI/Modal';

interface ReportRow {
  _id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGstin?: string;
  placeOfSupply?: string;
  source: string;
  paymentStatus: string;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGST: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  refundAmount: number;
}

interface HsnRow {
  hsnSac: string;
  gstRate: number;
  quantity: number;
  taxableAmount: number;
  gstAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
}

interface SalesReportData {
  summary: {
    invoiceCount: number;
    grossSales: number;
    discount: number;
    taxableAmount: number;
    totalGST: number;
    cgst: number;
    sgst: number;
    igst: number;
    refunds: number;
    netSales: number;
    amountReceived: number;
    balanceDue: number;
  };
  trend: Array<{ date: string; sales: number; taxable: number; gst: number; invoiceCount: number }>;
  hsnSummary: HsnRow[];
  items: ReportRow[];
  itemsTotal: number;
  itemsTruncated: boolean;
}

interface Filters {
  startDate: string;
  endDate: string;
  customer: string;
  hsnSac: string;
  paymentStatus: string;
  source: string;
}

const PAGE_SIZE = 25;
const toInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const presetRange = (preset: 'thisMonth' | 'lastMonth' | 'thisFy'): [string, string] => {
  const now = new Date();
  if (preset === 'thisMonth') return [toInput(new Date(now.getFullYear(), now.getMonth(), 1)), toInput(now)];
  if (preset === 'lastMonth')
    return [toInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)), toInput(new Date(now.getFullYear(), now.getMonth(), 0))];
  // Indian financial year starts 1 April.
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return [toInput(new Date(fyStartYear, 3, 1)), toInput(now)];
};

const emptyFilters = (): Filters => {
  const [startDate, endDate] = presetRange('thisFy');
  return { startDate, endDate, customer: '', hsnSac: '', paymentStatus: '', source: '' };
};

export const SalesReportPage: React.FC = () => {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(draft);
  const [data, setData] = useState<SalesReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const params = useMemo(
    () => Object.fromEntries(Object.entries(applied).filter(([, v]) => v)) as Record<string, string>,
    [applied]
  );

  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/reports/sales', { params });
      setData(res.data);
      setPage(1);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error loading sales report.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const exportReport = async (format: 'csv' | 'excel' | 'pdf') => {
    setExporting(format);
    try {
      const ext = format === 'excel' ? 'xlsx' : format;
      await downloadFile('/reports/sales/export', { format, ...params }, `navka-sales-report.${ext}`);
    } catch {
      setError('Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  const set = (key: keyof Filters, value: string) => setDraft((f) => ({ ...f, [key]: value }));
  const applyPreset = (preset: 'thisMonth' | 'lastMonth' | 'thisFy') => {
    const [startDate, endDate] = presetRange(preset);
    const next = { ...draft, startDate, endDate };
    setDraft(next);
    setApplied(next);
  };

  const s = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.items.length / PAGE_SIZE)) : 1;
  const pageRows = data ? data.items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : [];
  const money = (v?: number) => (isLoading || v === undefined ? '...' : formatCurrency(v));

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sales Report</h1>
          <p className="text-sm text-slate-500 mt-0.5">GST sales summary, HSN/SAC breakdown and invoice register.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => exportReport('csv')} disabled={!!exporting} className={secondaryButton}>
            <FileText className="w-4 h-4" />
            {exporting === 'csv' ? 'Exporting…' : 'CSV'}
          </button>
          <button onClick={() => exportReport('excel')} disabled={!!exporting} className={secondaryButton}>
            <FileSpreadsheet className="w-4 h-4" />
            {exporting === 'excel' ? 'Exporting…' : 'Excel'}
          </button>
          <button onClick={() => exportReport('pdf')} disabled={!!exporting} className={secondaryButton}>
            <FileDown className="w-4 h-4" />
            {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </span>
          <button onClick={fetchReport} className="text-xs font-semibold underline">
            Retry
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['thisMonth', 'This month'],
              ['lastMonth', 'Last month'],
              ['thisFy', 'This financial year'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => applyPreset(id)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 hover:bg-slate-50">
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Field label="From date">
            <input type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} className={inputClass()} />
          </Field>
          <Field label="To date">
            <input type="date" value={draft.endDate} onChange={(e) => set('endDate', e.target.value)} className={inputClass()} />
          </Field>
          <Field label="Customer">
            <input value={draft.customer} onChange={(e) => set('customer', e.target.value)} placeholder="Name or GSTIN" className={inputClass()} />
          </Field>
          <Field label="HSN / SAC">
            <input value={draft.hsnSac} onChange={(e) => set('hsnSac', e.target.value)} placeholder="Prefix, e.g. 8443" className={inputClass()} />
          </Field>
          <Field label="Payment status">
            <select value={draft.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value)} className={inputClass()}>
              <option value="">All</option>
              {['PAID', 'PARTIAL', 'PENDING', 'FAILED', 'REFUNDED'].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source">
            <select value={draft.source} onChange={(e) => set('source', e.target.value)} className={inputClass()}>
              <option value="">All</option>
              <option value="SHOPIFY">Shopify</option>
              <option value="MANUAL">Manual</option>
            </select>
          </Field>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setApplied({ ...draft })} className={primaryButton}>
            Run report
          </button>
          <button
            onClick={() => {
              const reset = emptyFilters();
              setDraft(reset);
              setApplied(reset);
            }}
            className={secondaryButton}
          >
            Reset
          </button>
        </div>
        <p className="text-xs text-slate-500">Cancelled invoices are excluded. Dates use the invoice date.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Gross Sales" value={money(s?.grossSales)} subtext={s ? `${s.invoiceCount} invoice(s)` : undefined} icon={IndianRupee} variant="emerald" />
        <StatCard title="Taxable Value" value={money(s?.taxableAmount)} subtext={s ? `Discount ${formatCurrency(s.discount)}` : undefined} icon={FileText} variant="blue" />
        <StatCard
          title="Total GST"
          value={money(s?.totalGST)}
          subtext={s ? `CGST ${formatCurrency(s.cgst)} · SGST ${formatCurrency(s.sgst)} · IGST ${formatCurrency(s.igst)}` : undefined}
          icon={Receipt}
          variant="indigo"
        />
        <StatCard title="Refunds" value={money(s?.refunds)} subtext={s ? `Net sales ${formatCurrency(s.netSales)}` : undefined} icon={RotateCcw} variant="rose" />
        <StatCard title="Amount Received" value={money(s?.amountReceived)} subtext="Completed payments" icon={Wallet} variant="emerald" />
        <StatCard title="Balance Due" value={money(s?.balanceDue)} subtext="Unpaid and partial invoices" icon={Clock} variant="amber" />
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Daily sales trend</h2>
        <div className="h-72 mt-4">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">Loading chart...</div>
          ) : !data?.trend.length ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">No sales in the selected period.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip formatter={(v: any) => [formatCurrency(Number(v)), '']} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend verticalAlign="top" align="right" wrapperStyle={{ paddingBottom: 10, fontSize: 12 }} />
                <Area type="monotone" dataKey="sales" name="Gross Sales (₹)" stroke="#059669" fill="#059669" fillOpacity={0.12} strokeWidth={2} />
                <Area type="monotone" dataKey="taxable" name="Taxable (₹)" stroke="#2563eb" fill="#2563eb" fillOpacity={0.06} strokeWidth={2} />
                <Area type="monotone" dataKey="gst" name="GST (₹)" stroke="#6366f1" fill="#6366f1" fillOpacity={0.12} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">HSN/SAC summary</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[760px]">
            <thead>
              <tr className="bg-slate-50/80 text-xs uppercase text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4">HSN/SAC</th>
                <th className="py-3 px-4 text-right">GST %</th>
                <th className="py-3 px-4 text-right">Qty</th>
                <th className="py-3 px-4 text-right">Taxable</th>
                <th className="py-3 px-4 text-right">CGST</th>
                <th className="py-3 px-4 text-right">SGST</th>
                <th className="py-3 px-4 text-right">IGST</th>
                <th className="py-3 px-4 text-right">Total GST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!data?.hsnSummary.length ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                    {isLoading ? 'Loading...' : 'No data'}
                  </td>
                </tr>
              ) : (
                data.hsnSummary.map((h) => (
                  <tr key={`${h.hsnSac}-${h.gstRate}`}>
                    <td className={`py-3 px-4 font-mono text-xs ${h.hsnSac === 'UNMAPPED' ? 'text-rose-600 font-semibold' : 'text-slate-700'}`}>
                      {h.hsnSac}
                    </td>
                    <td className="py-3 px-4 text-right">{h.gstRate}%</td>
                    <td className="py-3 px-4 text-right">{h.quantity}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(h.taxableAmount)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(h.cgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(h.sgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(h.igst)}</td>
                    <td className="py-3 px-4 text-right font-medium text-indigo-700">{formatCurrency(h.gstAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice register</h2>
          {data?.itemsTruncated && (
            <p className="text-xs text-amber-700">
              Showing latest {data.items.length} of {data.itemsTotal}. Export to Excel for all rows.
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1100px]">
            <thead>
              <tr className="bg-slate-50/80 text-xs uppercase text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4">Invoice</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Place of supply</th>
                <th className="py-3 px-4 text-right">Taxable</th>
                <th className="py-3 px-4 text-right">CGST</th>
                <th className="py-3 px-4 text-right">SGST</th>
                <th className="py-3 px-4 text-right">IGST</th>
                <th className="py-3 px-4 text-right">Total</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!pageRows.length ? (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-sm text-slate-400">
                    {isLoading ? 'Loading...' : 'No invoices match the filters'}
                  </td>
                </tr>
              ) : (
                pageRows.map((r) => (
                  <tr key={r._id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-semibold">
                      <Link to={`/invoices/${r._id}`} className="text-slate-900 hover:underline">
                        {r.invoiceNumber}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{formatDate(r.invoiceDate)}</td>
                    <td className="py-3 px-4">
                      <span className="text-slate-800">{r.customerName}</span>
                      {r.customerGstin && <span className="block text-[11px] font-mono text-slate-500">{r.customerGstin}</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{r.placeOfSupply || '—'}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(r.taxableAmount)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(r.cgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(r.sgst)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(r.igst)}</td>
                    <td className="py-3 px-4 text-right font-semibold">{formatCurrency(r.grandTotal)}</td>
                    <td className="py-3 px-4 text-right">{formatCurrency(r.balanceDue)}</td>
                    <td className="py-3 px-4">
                      <StatusBadge label={r.paymentStatus} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50/50">
          <p className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
