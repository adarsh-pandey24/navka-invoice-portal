import { FilterQuery, PipelineStage } from 'mongoose';
import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Invoice, { IInvoice } from '../models/Invoice';
import BusinessSettings from '../models/BusinessSettings';
import { AppError } from '../middleware/errorMiddleware';
import { ENV } from '../config/env';
import { round2, splitGst } from '../services/calculationService';
import { DATE_FMT, ExportColumn, MONEY_FMT, sendCsv, sendExcel } from '../services/exportService';
import { generateSalesReportPdf } from '../services/pdfService';
import { getPlaceOfSupply, getSupplyType } from '../utils/gstState';
import { buildDateRange, containsRegex, escapeRegex, parseEnumList, queryString } from '../utils/query';

const PAYMENT_STATUSES = ['PAID', 'PENDING', 'PARTIAL', 'FAILED', 'REFUNDED'] as const;
const INVOICE_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
const SOURCES = ['SHOPIFY', 'MANUAL'] as const;
const VIEW_ROW_LIMIT = 2000;
const EXPORT_ROW_LIMIT = 50_000;

export interface ReportFilters {
  startDate?: string;
  endDate?: string;
  customer?: string;
  hsnSac?: string;
  paymentStatus: string[];
  invoiceStatus: string[];
  source: string[];
}

export interface ReportRow {
  _id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  customerName: string;
  customerGstin?: string;
  placeOfSupply?: string;
  source: string;
  paymentStatus: string;
  invoiceStatus: string;
  taxableAmount: number;
  totalGST: number;
  cgst: number;
  sgst: number;
  igst: number;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  refundAmount: number;
}

export interface HsnSummaryRow {
  hsnSac: string;
  gstRate: number;
  quantity: number;
  taxableAmount: number;
  gstAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface SalesReport {
  filters: ReportFilters;
  generatedAt: string;
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
  hsnSummary: HsnSummaryRow[];
  items: ReportRow[];
  itemsTotal: number;
  itemsTruncated: boolean;
}

const parseFilters = (query: Request['query']): ReportFilters => {
  const invoiceStatus = parseEnumList(query.invoiceStatus, INVOICE_STATUSES);
  return {
    startDate: queryString(query.startDate) || undefined,
    endDate: queryString(query.endDate) || undefined,
    customer: queryString(query.customer) || undefined,
    hsnSac: queryString(query.hsnSac) || undefined,
    paymentStatus: parseEnumList(query.paymentStatus, PAYMENT_STATUSES),
    // Cancelled invoices are not sales; include them only when asked for explicitly.
    invoiceStatus: invoiceStatus.length ? invoiceStatus : ['ACTIVE'],
    source: parseEnumList(query.source, SOURCES),
  };
};

const buildMatch = (f: ReportFilters): FilterQuery<IInvoice> => {
  const match: FilterQuery<IInvoice> = { invoiceStatus: { $in: f.invoiceStatus } };
  const dateRange = buildDateRange(f.startDate, f.endDate);
  if (dateRange) match.invoiceDate = dateRange;
  if (f.customer) {
    const rx = containsRegex(f.customer);
    match.$or = [{ 'customer.name': rx }, { 'customer.gstin': rx }];
  }
  // HSN filter is a prefix match, so "8443" finds every 8443xx code.
  if (f.hsnSac) match['items.hsnSac'] = new RegExp(`^${escapeRegex(f.hsnSac)}`, 'i');
  if (f.paymentStatus.length) match.paymentStatus = { $in: f.paymentStatus };
  if (f.source.length) match.source = { $in: f.source };
  return match;
};

// Fields needed to decide intra-state vs inter-state supply.
const SUPPLY_KEY = {
  bizGstin: '$businessDetails.gstin',
  custGstin: '$customer.gstin',
  state: { $ifNull: ['$customer.shippingAddress.state', '$customer.billingAddress.state'] },
};

const supplyOf = (k: { bizGstin?: string; custGstin?: string; state?: string }) =>
  getSupplyType(k.bizGstin, { gstin: k.custGstin, state: k.state });

/**
 * Sales report via aggregation (plan section J): summary KPIs, daily trend,
 * HSN/SAC breakdown with CGST/SGST/IGST, and itemised invoice rows.
 */
export const buildSalesReport = async (query: Request['query'], rowLimit: number): Promise<SalesReport> => {
  const filters = parseFilters(query);
  const match = buildMatch(filters);

  const withPayments: PipelineStage[] = [
    { $match: match },
    {
      $lookup: {
        from: 'payments',
        localField: '_id',
        foreignField: 'invoiceId',
        as: 'completedPayments',
        pipeline: [{ $match: { paymentStatus: 'COMPLETED' } }, { $project: { amount: 1 } }],
      },
    },
    {
      $addFields: {
        amountPaid: { $sum: '$completedPayments.amount' },
        refundAmount: {
          $cond: [{ $eq: ['$refundDetails.isRefunded', true] }, { $ifNull: ['$refundDetails.refundAmount', 0] }, 0],
        },
      },
    },
    {
      $addFields: {
        balanceDue: {
          $cond: [
            { $eq: ['$paymentStatus', 'REFUNDED'] },
            0,
            { $max: [0, { $subtract: ['$grandTotal', '$amountPaid'] }] },
          ],
        },
      },
    },
  ];

  const [facet] = await Invoice.aggregate([
    ...withPayments,
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              invoiceCount: { $sum: 1 },
              grossSales: { $sum: '$grandTotal' },
              discount: { $sum: '$discount' },
              taxableAmount: { $sum: '$taxableAmount' },
              totalGST: { $sum: '$totalGST' },
              refunds: { $sum: '$refundAmount' },
              amountReceived: { $sum: '$amountPaid' },
              balanceDue: { $sum: '$balanceDue' },
            },
          },
        ],
        supplyGroups: [{ $group: { _id: SUPPLY_KEY, gst: { $sum: '$totalGST' } } }],
        trend: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$invoiceDate', timezone: ENV.REPORT_TIMEZONE } },
              sales: { $sum: '$grandTotal' },
              taxable: { $sum: '$taxableAmount' },
              gst: { $sum: '$totalGST' },
              invoiceCount: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        rows: [
          { $sort: { invoiceDate: -1, _id: -1 } },
          { $limit: rowLimit },
          {
            $project: {
              invoiceNumber: 1,
              invoiceDate: 1,
              customerName: '$customer.name',
              customerGstin: '$customer.gstin',
              state: SUPPLY_KEY.state,
              bizGstin: SUPPLY_KEY.bizGstin,
              source: 1,
              paymentStatus: 1,
              invoiceStatus: 1,
              taxableAmount: 1,
              totalGST: 1,
              grandTotal: 1,
              amountPaid: 1,
              balanceDue: 1,
              refundAmount: 1,
            },
          },
        ],
        rowCount: [{ $count: 'n' }],
      },
    },
  ]);

  const hsnFilter = filters.hsnSac ? [{ $match: { 'items.hsnSac': match['items.hsnSac'] } }] : [];
  const hsnGroups = await Invoice.aggregate([
    { $match: match },
    { $unwind: '$items' },
    ...hsnFilter,
    {
      $group: {
        _id: { hsnSac: '$items.hsnSac', gstRate: '$items.gstRate', ...SUPPLY_KEY },
        quantity: { $sum: '$items.quantity' },
        taxableAmount: { $sum: '$items.taxableAmount' },
        gstAmount: { $sum: '$items.gstAmount' },
      },
    },
  ]);

  // Fold supply-type groups into CGST/SGST/IGST totals.
  const split = { cgst: 0, sgst: 0, igst: 0 };
  for (const g of facet.supplyGroups as Array<{ _id: any; gst: number }>) {
    const s = splitGst(g.gst, supplyOf(g._id));
    split.cgst += s.cgst;
    split.sgst += s.sgst;
    split.igst += s.igst;
  }

  const hsnMap = new Map<string, HsnSummaryRow>();
  for (const g of hsnGroups) {
    const key = `${g._id.hsnSac}|${g._id.gstRate}`;
    const row = hsnMap.get(key) || {
      hsnSac: g._id.hsnSac,
      gstRate: g._id.gstRate,
      quantity: 0,
      taxableAmount: 0,
      gstAmount: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
    };
    const s = splitGst(g.gstAmount, supplyOf(g._id));
    row.quantity += g.quantity;
    row.taxableAmount = round2(row.taxableAmount + g.taxableAmount);
    row.gstAmount = round2(row.gstAmount + g.gstAmount);
    row.cgst = round2(row.cgst + s.cgst);
    row.sgst = round2(row.sgst + s.sgst);
    row.igst = round2(row.igst + s.igst);
    hsnMap.set(key, row);
  }
  const hsnSummary = Array.from(hsnMap.values()).sort(
    (a, b) => b.taxableAmount - a.taxableAmount || a.hsnSac.localeCompare(b.hsnSac)
  );

  const items: ReportRow[] = (facet.rows as any[]).map((r) => {
    const s = splitGst(r.totalGST, supplyOf({ bizGstin: r.bizGstin, custGstin: r.customerGstin, state: r.state }));
    return {
      _id: String(r._id),
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      customerName: r.customerName,
      customerGstin: r.customerGstin || undefined,
      placeOfSupply: getPlaceOfSupply({ gstin: r.customerGstin, state: r.state }),
      source: r.source,
      paymentStatus: r.paymentStatus,
      invoiceStatus: r.invoiceStatus,
      taxableAmount: round2(r.taxableAmount),
      totalGST: round2(r.totalGST),
      ...s,
      grandTotal: round2(r.grandTotal),
      amountPaid: round2(r.amountPaid),
      balanceDue: round2(r.balanceDue),
      refundAmount: round2(r.refundAmount),
    };
  });

  const sum = facet.summary[0] || {};
  const grossSales = round2(sum.grossSales || 0);
  const refunds = round2(sum.refunds || 0);
  const itemsTotal = facet.rowCount[0]?.n || 0;

  return {
    filters,
    generatedAt: new Date().toISOString(),
    summary: {
      invoiceCount: sum.invoiceCount || 0,
      grossSales,
      discount: round2(sum.discount || 0),
      taxableAmount: round2(sum.taxableAmount || 0),
      totalGST: round2(sum.totalGST || 0),
      cgst: round2(split.cgst),
      sgst: round2(split.sgst),
      igst: round2(split.igst),
      refunds,
      netSales: round2(grossSales - refunds),
      amountReceived: round2(sum.amountReceived || 0),
      balanceDue: round2(sum.balanceDue || 0),
    },
    trend: (facet.trend as any[]).map((t) => ({
      date: t._id,
      sales: round2(t.sales),
      taxable: round2(t.taxable),
      gst: round2(t.gst),
      invoiceCount: t.invoiceCount,
    })),
    hsnSummary,
    items,
    itemsTotal,
    itemsTruncated: itemsTotal > items.length,
  };
};

// GET /api/reports/sales — Admin & CA
export const getSalesReport = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const report = await buildSalesReport(req.query, VIEW_ROW_LIMIT);
    res.status(200).json({ success: true, ...report });
  } catch (error) {
    next(error);
  }
};

export const REPORT_ROW_COLUMNS: ExportColumn<ReportRow>[] = [
  { header: 'Invoice Number', width: 22, value: (r) => r.invoiceNumber },
  { header: 'Invoice Date', width: 14, numFmt: DATE_FMT, value: (r) => new Date(r.invoiceDate) },
  { header: 'Customer', width: 28, value: (r) => r.customerName },
  { header: 'Customer GSTIN', width: 18, value: (r) => r.customerGstin },
  { header: 'Place of Supply', width: 20, value: (r) => r.placeOfSupply },
  { header: 'Source', width: 10, value: (r) => r.source },
  { header: 'Taxable Value', width: 15, numFmt: MONEY_FMT, value: (r) => r.taxableAmount },
  { header: 'CGST', width: 12, numFmt: MONEY_FMT, value: (r) => r.cgst },
  { header: 'SGST', width: 12, numFmt: MONEY_FMT, value: (r) => r.sgst },
  { header: 'IGST', width: 12, numFmt: MONEY_FMT, value: (r) => r.igst },
  { header: 'Total GST', width: 13, numFmt: MONEY_FMT, value: (r) => r.totalGST },
  { header: 'Grand Total', width: 14, numFmt: MONEY_FMT, value: (r) => r.grandTotal },
  { header: 'Amount Paid', width: 14, numFmt: MONEY_FMT, value: (r) => r.amountPaid },
  { header: 'Balance Due', width: 14, numFmt: MONEY_FMT, value: (r) => r.balanceDue },
  { header: 'Refund', width: 12, numFmt: MONEY_FMT, value: (r) => r.refundAmount },
  { header: 'Payment Status', width: 15, value: (r) => r.paymentStatus },
  { header: 'Invoice Status', width: 14, value: (r) => r.invoiceStatus },
];

const HSN_COLUMNS: ExportColumn<HsnSummaryRow>[] = [
  { header: 'HSN/SAC', width: 12, value: (r) => r.hsnSac },
  { header: 'GST Rate %', width: 11, value: (r) => r.gstRate },
  { header: 'Quantity', width: 10, value: (r) => r.quantity },
  { header: 'Taxable Value', width: 15, numFmt: MONEY_FMT, value: (r) => r.taxableAmount },
  { header: 'CGST', width: 12, numFmt: MONEY_FMT, value: (r) => r.cgst },
  { header: 'SGST', width: 12, numFmt: MONEY_FMT, value: (r) => r.sgst },
  { header: 'IGST', width: 12, numFmt: MONEY_FMT, value: (r) => r.igst },
  { header: 'Total GST', width: 13, numFmt: MONEY_FMT, value: (r) => r.gstAmount },
];

const TREND_COLUMNS: ExportColumn<SalesReport['trend'][number]>[] = [
  { header: 'Date', width: 12, value: (r) => r.date },
  { header: 'Invoices', width: 10, value: (r) => r.invoiceCount },
  { header: 'Taxable Value', width: 15, numFmt: MONEY_FMT, value: (r) => r.taxable },
  { header: 'GST', width: 13, numFmt: MONEY_FMT, value: (r) => r.gst },
  { header: 'Sales', width: 15, numFmt: MONEY_FMT, value: (r) => r.sales },
];

export const summaryRows = (report: SalesReport): Array<{ label: string; value: string | number }> => {
  const s = report.summary;
  const f = report.filters;
  return [
    { label: 'Period', value: `${f.startDate || 'Beginning'} to ${f.endDate || 'Today'}` },
    { label: 'Invoices', value: String(s.invoiceCount) },
    { label: 'Gross Sales', value: s.grossSales },
    { label: 'Discount', value: s.discount },
    { label: 'Taxable Value', value: s.taxableAmount },
    { label: 'CGST', value: s.cgst },
    { label: 'SGST', value: s.sgst },
    { label: 'IGST', value: s.igst },
    { label: 'Total GST', value: s.totalGST },
    { label: 'Refunds', value: s.refunds },
    { label: 'Net Sales', value: s.netSales },
    { label: 'Amount Received', value: s.amountReceived },
    { label: 'Balance Due', value: s.balanceDue },
  ];
};

// GET /api/reports/sales/export?format=csv|excel|pdf — Admin & CA
export const exportSalesReport = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const format = queryString(req.query.format).toLowerCase() || 'csv';
    if (!['csv', 'excel', 'pdf'].includes(format)) {
      throw new AppError('Export format must be csv, excel or pdf.', 400);
    }
    // A PDF register of tens of thousands of rows is unusable; it shows the latest rows only.
    const report = await buildSalesReport(req.query, format === 'pdf' ? VIEW_ROW_LIMIT : EXPORT_ROW_LIMIT);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      await sendCsv(res, `navka-sales-report-${stamp}.csv`, REPORT_ROW_COLUMNS, report.items);
    } else if (format === 'excel') {
      await sendExcel(res, `navka-sales-report-${stamp}.xlsx`, [
        {
          name: 'Summary',
          columns: [
            { header: 'Metric', width: 22, value: (r: { label: string }) => r.label },
            { header: 'Value', width: 22, numFmt: MONEY_FMT, value: (r: { value: string | number }) => r.value },
          ],
          rows: summaryRows(report),
        },
        { name: 'Invoices', columns: REPORT_ROW_COLUMNS, rows: report.items },
        { name: 'HSN Summary', columns: HSN_COLUMNS, rows: report.hsnSummary },
        { name: 'Daily Trend', columns: TREND_COLUMNS, rows: report.trend },
      ]);
    } else {
      const settings = await BusinessSettings.findOne().lean();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="navka-sales-report-${stamp}.pdf"`);
      generateSalesReportPdf(report, summaryRows(report), settings?.businessName || 'NAVKA Enterprises', res);
    }
  } catch (error) {
    next(error);
  }
};
