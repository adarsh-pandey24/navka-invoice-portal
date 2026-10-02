import React, { useState, useEffect } from 'react';
import { 
  IndianRupee, 
  FileText, 
  Receipt, 
  Clock, 
  RotateCcw,
  BarChart2,
  Table as TableIcon,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  XCircle,
  HelpCircle
} from 'lucide-react';
import apiClient from '../services/api';
import { StatCard } from '../components/StatCard/StatCard';
import { DatePeriodFilter, PeriodType } from '../components/Filters/DatePeriodFilter';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from 'recharts';

interface DashboardData {
  period: string;
  summary: {
    totalSales: number;
    totalInvoices: number;
    totalGST: number;
    pendingPayments: number;
    refunds: number;
  };
  paymentOverview: {
    paid: { count: number; amount: number };
    pending: { count: number; amount: number };
    failed: { count: number; amount: number };
    refunded: { count: number; amount: number };
    partial: { count: number; amount: number };
  };
  salesTrend: Array<{
    date: string;
    sales: number;
    taxable: number;
    gst: number;
    invoiceCount: number;
  }>;
}

export const DashboardPage: React.FC = () => {
  const [period, setPeriod] = useState<PeriodType>('all');
  const [customStart, setCustomStart] = useState<string>('');
  const [customEnd, setCustomEnd] = useState<string>('');
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: any = { period };
      if (period === 'custom' && customStart && customEnd) {
        params.startDate = customStart;
        params.endDate = customEnd;
      }

      const res = await apiClient.get('/dashboard', { params });
      if (res.data?.success) {
        setData(res.data);
      } else {
        setError('Failed to load dashboard data.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error fetching dashboard metrics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [period, customStart, customEnd]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 2,
    }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Filters Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Financial Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time billing, GST compliance, and payment settlement summary.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DatePeriodFilter
            activePeriod={period}
            onPeriodChange={(p) => setPeriod(p)}
            startDate={customStart}
            endDate={customEnd}
            onCustomDateChange={(start, end) => {
              setCustomStart(start);
              setCustomEnd(end);
            }}
          />

          <button
            onClick={fetchDashboardData}
            title="Refresh Metrics"
            disabled={isLoading}
            className="p-2.5 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={fetchDashboardData}
            className="text-xs font-semibold underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* 1. Summary Cards (Total Sales, Total Invoices, Total GST, Pending, Refunds) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Total Sales"
          value={isLoading ? '...' : formatCurrency(data?.summary.totalSales || 0)}
          subtext="Net billed gross value"
          icon={IndianRupee}
          variant="emerald"
        />

        <StatCard
          title="Invoices Issued"
          value={isLoading ? '...' : data?.summary.totalInvoices || 0}
          subtext="Total active tax invoices"
          icon={FileText}
          variant="blue"
        />

        <StatCard
          title="Total GST"
          value={isLoading ? '...' : formatCurrency(data?.summary.totalGST || 0)}
          subtext="Overall collected tax"
          icon={Receipt}
          variant="indigo"
        />

        <StatCard
          title="Pending Payments"
          value={isLoading ? '...' : formatCurrency(data?.summary.pendingPayments || 0)}
          subtext="Unsettled & partial dues"
          icon={Clock}
          variant="amber"
        />

        <StatCard
          title="Refunds"
          value={isLoading ? '...' : formatCurrency(data?.summary.refunds || 0)}
          subtext="Shopify returns refunded"
          icon={RotateCcw}
          variant="rose"
        />
      </div>

      {/* 2. Sales View (Graph View & Table View) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 tracking-tight">
              Sales & Tax Revenue Breakdown
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Daily trend of gross invoicing, taxable amount, and GST collections.
            </p>
          </div>

          {/* Graph vs Table Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setViewMode('graph')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === 'graph'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Graph View</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                viewMode === 'table'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Table View</span>
            </button>
          </div>
        </div>

        {/* Content depending on viewMode */}
        {viewMode === 'graph' ? (
          <div className="h-72 w-full">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                Loading sales trend chart...
              </div>
            ) : !data?.salesTrend || data.salesTrend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                No sales data recorded for the selected period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.salesTrend}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#059669" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="gstGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: any) => [formatCurrency(Number(value)), '']}
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ paddingBottom: '10px', fontSize: '12px' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    name="Gross Sales (₹)"
                    stroke="#059669"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#salesGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="gst"
                    name="GST Collected (₹)"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#gstGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-slate-600 text-xs uppercase font-semibold">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Invoices Issued</th>
                  <th className="py-3 px-4">Taxable Value</th>
                  <th className="py-3 px-4">Total GST</th>
                  <th className="py-3 px-4 text-right">Gross Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {!data?.salesTrend || data.salesTrend.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400 text-xs">
                      No records found for the selected period.
                    </td>
                  </tr>
                ) : (
                  data.salesTrend.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-medium text-slate-900">{row.date}</td>
                      <td className="py-3 px-4">{row.invoiceCount}</td>
                      <td className="py-3 px-4">{formatCurrency(row.taxable)}</td>
                      <td className="py-3 px-4 text-indigo-600 font-medium">
                        {formatCurrency(row.gst)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-emerald-700">
                        {formatCurrency(row.sales)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Payment Overview (Paid, Pending, Failed, Refunded) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="mb-5">
          <h2 className="text-base font-bold text-slate-900 tracking-tight">
            Payment Settlement Overview
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Distribution of transaction status across all sales channels.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Paid */}
          <div className="p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                Settled / Paid
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-xl font-bold text-slate-900 mt-2">
              {formatCurrency(data?.paymentOverview.paid.amount || 0)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold text-slate-700">
                {data?.paymentOverview.paid.count || 0}
              </span>{' '}
              transactions completed
            </p>
          </div>

          {/* Pending */}
          <div className="p-4 rounded-xl border border-amber-200/80 bg-amber-50/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
                Pending Settlement
              </span>
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <p className="text-xl font-bold text-slate-900 mt-2">
              {formatCurrency(data?.paymentOverview.pending.amount || 0)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold text-slate-700">
                {data?.paymentOverview.pending.count || 0}
              </span>{' '}
              invoices awaiting payment
            </p>
          </div>

          {/* Failed */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Failed Gateway
              </span>
              <XCircle className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-xl font-bold text-slate-900 mt-2">
              {formatCurrency(data?.paymentOverview.failed.amount || 0)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold text-slate-700">
                {data?.paymentOverview.failed.count || 0}
              </span>{' '}
              attempted transactions
            </p>
          </div>

          {/* Refunded */}
          <div className="p-4 rounded-xl border border-rose-200/80 bg-rose-50/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-rose-800 uppercase tracking-wider">
                Refunded
              </span>
              <RotateCcw className="w-4 h-4 text-rose-600" />
            </div>
            <p className="text-xl font-bold text-slate-900 mt-2">
              {formatCurrency(data?.paymentOverview.refunded.amount || 0)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              <span className="font-semibold text-slate-700">
                {data?.paymentOverview.refunded.count || 0}
              </span>{' '}
              returns processed
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
