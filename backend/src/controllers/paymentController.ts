import mongoose, { FilterQuery } from 'mongoose';
import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Invoice from '../models/Invoice';
import Payment, { IPayment } from '../models/Payment';
import { AppError } from '../middleware/errorMiddleware';
import { round2 } from '../services/calculationService';
import { getAmountPaid, reconcileInvoicePaymentStatus } from '../services/paymentService';
import { DATE_FMT, ExportColumn, MONEY_FMT, sendCsv, sendExcel } from '../services/exportService';
import {
  buildDateRange,
  buildNumberRange,
  containsRegex,
  parseEnumList,
  parsePositiveInt,
  queryString,
} from '../utils/query';

const PAYMENT_METHODS = ['ONLINE', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
const OFFLINE_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
const PAYMENT_SOURCES = ['ONLINE', 'OFFLINE'] as const;
const PAYMENT_STATUSES = ['COMPLETED', 'PENDING', 'FAILED', 'REFUNDED'] as const;
const EXPORT_LIMIT = 50_000;

/** Builds the Payment filter shared by the ledger list and its export. */
const buildPaymentFilter = async (query: Request['query']): Promise<FilterQuery<IPayment>> => {
  const filter: FilterQuery<IPayment> = {};

  const statuses = parseEnumList(query.status ?? query.paymentStatus, PAYMENT_STATUSES);
  const methods = parseEnumList(query.method ?? query.paymentMethod, PAYMENT_METHODS);
  const sources = parseEnumList(query.source ?? query.paymentSource, PAYMENT_SOURCES);
  if (statuses.length) filter.paymentStatus = { $in: statuses };
  if (methods.length) filter.paymentMethod = { $in: methods };
  if (sources.length) filter.paymentSource = { $in: sources };

  // `date` = one day; startDate/endDate = range.
  const date = queryString(query.date);
  const dateRange = date ? buildDateRange(date, date) : buildDateRange(query.startDate, query.endDate);
  if (dateRange) filter.paymentDate = dateRange;

  const amountRange = buildNumberRange(query.minAmount, query.maxAmount);
  if (amountRange) filter.amount = amountRange;

  const invoiceId = queryString(query.invoiceId);
  if (invoiceId && mongoose.isValidObjectId(invoiceId)) filter.invoiceId = new mongoose.Types.ObjectId(invoiceId);

  // Search: reference / order id on the payment, or invoice number / customer on the invoice.
  const search = queryString(query.search);
  if (search) {
    const rx = containsRegex(search);
    const invoiceIds = await Invoice.find({ $or: [{ invoiceNumber: rx }, { 'customer.name': rx }] })
      .select('_id')
      .limit(1000)
      .lean();
    filter.$or = [{ referenceId: rx }, { orderId: rx }, { invoiceId: { $in: invoiceIds.map((i) => i._id) } }];
  }

  return filter;
};

const INVOICE_FIELDS = 'invoiceNumber customer.name grandTotal paymentStatus invoiceStatus source';

// GET /api/payments — Admin & CA. Unified online + offline ledger.
export const listPayments = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 1, 100_000);
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const filter = await buildPaymentFilter(req.query);

    const [payments, totalRecords, totalsAgg] = await Promise.all([
      Payment.find(filter)
        .sort({ paymentDate: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('invoiceId', INVOICE_FIELDS)
        .populate('recordedBy', 'name')
        .lean(),
      Payment.countDocuments(filter),
      Payment.aggregate([
        { $match: filter },
        {
          $group: {
            _id: '$paymentSource',
            amount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'COMPLETED'] }, '$amount', 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const bySource = (source: string) => totalsAgg.find((t) => t._id === source) || { amount: 0, count: 0 };
    const online = bySource('ONLINE');
    const offline = bySource('OFFLINE');

    res.status(200).json({
      success: true,
      payments,
      summary: {
        // Only COMPLETED payments count as money received.
        totalReceived: round2(online.amount + offline.amount),
        onlineReceived: round2(online.amount),
        offlineReceived: round2(offline.amount),
        onlineCount: online.count,
        offlineCount: offline.count,
      },
      pagination: {
        currentPage: page,
        limit,
        totalRecords,
        totalPages: Math.max(1, Math.ceil(totalRecords / limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createPaymentSchema = z
  .object({
    invoiceId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid invoice ID'),
    amount: z.number().positive('Amount must be greater than zero').max(1_000_000_000),
    paymentDate: z.coerce.date().optional(),
    paymentMethod: z.enum(OFFLINE_METHODS, {
      errorMap: () => ({ message: 'Payment method must be CASH, BANK_TRANSFER, CHEQUE or OTHER' }),
    }),
    referenceId: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((d) => !['CHEQUE', 'BANK_TRANSFER'].includes(d.paymentMethod) || !!d.referenceId, {
    path: ['referenceId'],
    message: 'Reference (cheque number / UTR) is required for cheque and bank transfer payments',
  })
  .refine(
    (d) => {
      if (!d.paymentDate) return true;
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      return d.paymentDate <= endOfToday;
    },
    { path: ['paymentDate'], message: 'Payment date cannot be in the future' }
  );

// POST /api/payments — Admin only. Records an offline payment and reconciles the invoice.
export const createPayment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as z.infer<typeof createPaymentSchema>;
    const invoice = await Invoice.findById(body.invoiceId);
    if (!invoice) {
      throw new AppError('Invoice not found.', 404);
    }
    if (invoice.invoiceStatus === 'CANCELLED') {
      throw new AppError('Payments cannot be recorded against a cancelled invoice.', 400);
    }
    if (invoice.paymentStatus === 'REFUNDED') {
      throw new AppError('Payments cannot be recorded against a refunded invoice.', 400);
    }

    const amount = round2(body.amount);
    const balanceDue = round2(Math.max(0, invoice.grandTotal - (await getAmountPaid(invoice._id))));
    if (balanceDue <= 0) {
      throw new AppError('This invoice is already fully paid.', 400);
    }
    if (amount > balanceDue) {
      throw new AppError(`Amount exceeds the balance due of ${balanceDue.toFixed(2)}.`, 400);
    }

    const payment = await Payment.create({
      invoiceId: invoice._id,
      orderId: invoice.shopifyOrderNumber || invoice.invoiceNumber,
      amount,
      paymentDate: body.paymentDate || new Date(),
      paymentMethod: body.paymentMethod,
      paymentSource: 'OFFLINE',
      paymentStatus: 'COMPLETED',
      referenceId: body.referenceId || undefined,
      notes: body.notes || undefined,
      recordedBy: req.user?.id,
    });

    const reconciled = await reconcileInvoicePaymentStatus(invoice._id);
    res.status(201).json({
      success: true,
      payment,
      updatedInvoiceStatus: reconciled?.paymentStatus,
      balanceDue: reconciled?.balanceDue,
    });
  } catch (error) {
    next(error);
  }
};

export const updatePaymentSchema = z
  .object({
    referenceId: z.string().trim().max(100).optional(),
    notes: z.string().trim().max(500).optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  })
  .refine((d) => d.referenceId !== undefined || d.notes !== undefined || d.paymentStatus !== undefined, {
    message: 'Provide referenceId, notes or paymentStatus to update',
  });

// PUT /api/payments/:id — Admin only. Online (Shopify) payments are owned by the sync.
export const updatePayment = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError('Invalid payment ID.', 400);
    }
    const body = req.body as z.infer<typeof updatePaymentSchema>;

    const payment = await Payment.findById(id);
    if (!payment) {
      throw new AppError('Payment not found.', 404);
    }
    if (payment.paymentSource !== 'OFFLINE') {
      throw new AppError('Online payments are synced from Shopify and cannot be edited.', 400);
    }

    // Re-completing a payment must not push the invoice over its total.
    if (body.paymentStatus === 'COMPLETED' && payment.paymentStatus !== 'COMPLETED') {
      const invoice = await Invoice.findById(payment.invoiceId).select('grandTotal');
      const paid = await getAmountPaid(payment.invoiceId);
      if (invoice && round2(paid + payment.amount) > invoice.grandTotal) {
        throw new AppError('Marking this payment completed would exceed the invoice total.', 400);
      }
    }

    if (body.referenceId !== undefined) payment.referenceId = body.referenceId || undefined;
    if (body.notes !== undefined) payment.notes = body.notes || undefined;
    if (body.paymentStatus) payment.paymentStatus = body.paymentStatus;
    await payment.save();

    const reconciled = await reconcileInvoicePaymentStatus(payment.invoiceId);
    res.status(200).json({ success: true, payment, updatedInvoiceStatus: reconciled?.paymentStatus });
  } catch (error) {
    next(error);
  }
};

interface PaymentExportRow {
  paymentDate: Date;
  invoiceId?: { invoiceNumber?: string; customer?: { name?: string } } | null;
  orderId?: string;
  amount: number;
  paymentMethod: string;
  paymentSource: string;
  paymentStatus: string;
  referenceId?: string;
  notes?: string;
  recordedBy?: { name?: string } | null;
}

const PAYMENT_EXPORT_COLUMNS: ExportColumn<PaymentExportRow>[] = [
  { header: 'Payment Date', width: 14, numFmt: DATE_FMT, value: (p) => new Date(p.paymentDate) },
  { header: 'Invoice Number', width: 22, value: (p) => p.invoiceId?.invoiceNumber },
  { header: 'Customer', width: 28, value: (p) => p.invoiceId?.customer?.name },
  { header: 'Order ID', width: 16, value: (p) => p.orderId },
  { header: 'Amount', width: 14, numFmt: MONEY_FMT, value: (p) => p.amount },
  { header: 'Method', width: 15, value: (p) => p.paymentMethod },
  { header: 'Source', width: 10, value: (p) => p.paymentSource },
  { header: 'Status', width: 12, value: (p) => p.paymentStatus },
  { header: 'Reference ID', width: 22, value: (p) => p.referenceId },
  { header: 'Recorded By', width: 22, value: (p) => p.recordedBy?.name || (p.paymentSource === 'ONLINE' ? 'Shopify' : '') },
  { header: 'Notes', width: 32, value: (p) => p.notes },
];

// GET /api/payments/export?format=csv|excel — Admin & CA, same filters as the ledger.
export const exportPayments = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const format = queryString(req.query.format).toLowerCase() || 'csv';
    if (!['csv', 'excel'].includes(format)) {
      throw new AppError('Export format must be csv or excel.', 400);
    }
    const filter = await buildPaymentFilter(req.query);
    const rows = (await Payment.find(filter)
      .sort({ paymentDate: -1, _id: -1 })
      .limit(EXPORT_LIMIT)
      .populate('invoiceId', INVOICE_FIELDS)
      .populate('recordedBy', 'name')
      .lean()) as unknown as PaymentExportRow[];

    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      await sendCsv(res, `navka-payments-${stamp}.csv`, PAYMENT_EXPORT_COLUMNS, rows);
    } else {
      await sendExcel(res, `navka-payments-${stamp}.xlsx`, [
        { name: 'Payments', columns: PAYMENT_EXPORT_COLUMNS, rows },
      ]);
    }
  } catch (error) {
    next(error);
  }
};
