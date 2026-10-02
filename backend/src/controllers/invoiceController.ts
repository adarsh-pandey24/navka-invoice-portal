import mongoose from 'mongoose';
import { z } from 'zod';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Invoice from '../models/Invoice';
import Payment from '../models/Payment';
import BusinessSettings from '../models/BusinessSettings';
import { IAddress } from '../models/Customer';
import { AppError } from '../middleware/errorMiddleware';
import { calculateInvoice } from '../services/calculationService';
import { generateInvoicePdf } from '../services/pdfService';
import { generateInvoiceNumber } from '../utils/invoiceNumberGen';
import { round2 } from '../services/calculationService';
import { buildDateRange, buildNumberRange, escapeRegex, parseEnumList, parsePositiveInt } from '../utils/query';

const SHIPPING_SAC = '996812';
const GST_RATES = [0, 5, 12, 18, 28];
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MAX_NUMBER_RETRIES = 5;

// Form fields arrive as '' when left blank; treat them as absent.
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''));

const addressSchema = z.object({
  street: optionalText(300),
  city: optionalText(100),
  state: optionalText(100),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional().or(z.literal('')),
  country: optionalText(100),
});

// Client-sent totals are ignored (unknown keys are stripped); the server recalculates everything.
export const createInvoiceSchema = z
  .object({
    customer: z.object({
      name: z.string().trim().min(1, 'Customer name is required').max(200),
      email: z.string().trim().email('Invalid customer email').optional().or(z.literal('')),
      phone: optionalText(30),
      gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN format').optional().or(z.literal('')),
      billingAddress: addressSchema.optional(),
      shippingAddress: addressSchema.optional(),
    }),
    items: z
      .array(
        z.object({
          productId: z
            .string()
            .refine((v) => mongoose.isValidObjectId(v), 'Invalid productId')
            .optional(),
          productName: z.string().trim().min(1, 'Product name is required').max(200),
          hsnSac: z.string().trim().regex(/^\d{4,8}$/, 'HSN/SAC must be 4 to 8 digits'),
          quantity: z.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1'),
          unitPrice: z.number().min(0, 'Unit price cannot be negative').max(1_000_000_000),
          discount: z.number().min(0, 'Discount cannot be negative').max(100, 'Discount cannot exceed 100%').default(0),
          gstRate: z.number().refine((v) => GST_RATES.includes(v), 'GST rate must be 0, 5, 12, 18 or 28'),
        })
      )
      .min(1, 'At least one line item is required')
      .max(100, 'An invoice can have at most 100 line items'),
    invoiceDate: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine(
    (d) => {
      if (!d.dueDate) return true;
      const start = new Date(d.invoiceDate || Date.now());
      start.setHours(0, 0, 0, 0);
      return d.dueDate >= start;
    },
    { path: ['dueDate'], message: 'Due date cannot be before the invoice date' }
  );

type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

const cleanAddress = (address?: z.infer<typeof addressSchema>): IAddress | undefined => {
  if (!address) return undefined;
  const entries = Object.entries(address).filter(([, v]) => v);
  return entries.length ? (Object.fromEntries(entries) as IAddress) : undefined;
};

const PAYMENT_STATUSES = ['PAID', 'PENDING', 'PARTIAL', 'FAILED', 'REFUNDED'] as const;
const INVOICE_STATUSES = ['ACTIVE', 'CANCELLED'] as const;

const isShippingItem = (item: { productName?: string; hsnSac?: string }): boolean => {
  const name = (item.productName || '').toLowerCase();
  return name.startsWith('shipping') || item.hsnSac === SHIPPING_SAC;
};

export const listInvoices = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const limit = parsePositiveInt(req.query.limit, 20, 1, 100);
    const skip = (page - 1) * limit;

    const search = String(req.query.search || req.query.q || '').trim();
    const invoiceNumber = String(req.query.invoiceNumber || '').trim();
    const shopifyOrderId = String(req.query.shopifyOrderId || '').trim();
    const customer = String(req.query.customer || '').trim();
    const product = String(req.query.product || '').trim();
    const hsnSac = String(req.query.hsnSac || '').trim();
    // Comma-separated lists allowed, e.g. paymentStatus=PENDING,PARTIAL
    const paymentStatuses = parseEnumList(req.query.paymentStatus, PAYMENT_STATUSES);
    const invoiceStatuses = parseEnumList(req.query.invoiceStatus, INVOICE_STATUSES);
    const month = String(req.query.month || '').trim();
    const sortByRaw = String(req.query.sortBy || 'invoiceDate');
    const sortOrder = String(req.query.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

    const allowedSort = new Set(['invoiceDate', 'grandTotal', 'invoiceNumber', 'createdAt', 'totalGST']);
    const sortBy = allowedSort.has(sortByRaw) ? sortByRaw : 'invoiceDate';

    const filter: Record<string, unknown> = {};
    const andClauses: Record<string, unknown>[] = [];

    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      andClauses.push({
        $or: [
          { invoiceNumber: rx },
          { shopifyOrderId: rx },
          { shopifyOrderNumber: rx },
          { 'customer.name': rx },
          { 'customer.email': rx },
          { 'items.productName': rx },
          { 'items.hsnSac': rx },
        ],
      });
    }

    if (invoiceNumber) {
      andClauses.push({ invoiceNumber: new RegExp(escapeRegex(invoiceNumber), 'i') });
    }
    if (shopifyOrderId) {
      const rx = new RegExp(escapeRegex(shopifyOrderId), 'i');
      andClauses.push({ $or: [{ shopifyOrderId: rx }, { shopifyOrderNumber: rx }] });
    }
    if (customer) {
      andClauses.push({ 'customer.name': new RegExp(escapeRegex(customer), 'i') });
    }
    if (product) {
      andClauses.push({ 'items.productName': new RegExp(escapeRegex(product), 'i') });
    }
    if (hsnSac) {
      andClauses.push({ 'items.hsnSac': new RegExp(escapeRegex(hsnSac), 'i') });
    }
    if (paymentStatuses.length) {
      filter.paymentStatus = { $in: paymentStatuses };
    }
    if (invoiceStatuses.length) {
      filter.invoiceStatus = { $in: invoiceStatuses };
    }

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number);
      const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
      const monthEnd = new Date(y, m, 0, 23, 59, 59, 999);
      filter.invoiceDate = { $gte: monthStart, $lte: monthEnd };
    } else {
      const dateRange = buildDateRange(req.query.startDate || req.query.date, req.query.endDate);
      if (dateRange) filter.invoiceDate = dateRange;
    }

    const amountRange = buildNumberRange(req.query.minAmount, req.query.maxAmount);
    if (amountRange) {
      filter.grandTotal = amountRange;
    }

    if (andClauses.length) {
      filter.$and = andClauses;
    }

    const [invoices, totalRecords] = await Promise.all([
      Invoice.find(filter)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invoice.countDocuments(filter),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

    res.status(200).json({
      success: true,
      invoices,
      pagination: {
        currentPage: page,
        limit,
        totalRecords,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getInvoiceById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      throw new AppError('Invalid invoice ID.', 400);
    }

    const invoice = await Invoice.findById(id).lean();
    if (!invoice) {
      throw new AppError('Invoice not found.', 404);
    }

    const payments = await Payment.find({ invoiceId: invoice._id }).sort({ paymentDate: -1 }).lean();

    const shippingItems = (invoice.items || []).filter(isShippingItem);
    const productItems = (invoice.items || []).filter((item) => !isShippingItem(item));
    const shippingCharges = shippingItems.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
    const amountPaid = round2(
      payments.filter((p) => p.paymentStatus === 'COMPLETED').reduce((sum, p) => sum + p.amount, 0)
    );

    res.status(200).json({
      success: true,
      invoice,
      payments,
      summary: {
        productSubtotal: productItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
        discount: invoice.discount,
        taxableAmount: invoice.taxableAmount,
        totalGST: invoice.totalGST,
        shippingCharges: Math.round(shippingCharges * 100) / 100,
        grandTotal: invoice.grandTotal,
        roundOff: invoice.roundOff,
        amountInWords: invoice.amountInWords,
        amountPaid,
        balanceDue: invoice.paymentStatus === 'REFUNDED' ? 0 : round2(Math.max(0, invoice.grandTotal - amountPaid)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const body = req.body as CreateInvoiceInput;
    const settings = (await BusinessSettings.findOne().lean()) || new BusinessSettings().toObject();

    const totals = calculateInvoice(body.items);
    const invoiceDate = body.invoiceDate || new Date();
    const billingAddress = cleanAddress(body.customer.billingAddress);

    const invoiceData = {
      invoiceDate,
      dueDate: body.dueDate,
      customer: {
        name: body.customer.name,
        email: body.customer.email || undefined,
        phone: body.customer.phone || undefined,
        gstin: body.customer.gstin || undefined,
        billingAddress,
        shippingAddress: cleanAddress(body.customer.shippingAddress) || billingAddress,
      },
      businessDetails: {
        name: settings.businessName,
        address: settings.address,
        gstin: settings.gstin,
        phone: settings.contactPhone,
        email: settings.contactEmail,
        logoUrl: settings.logoUrl,
      },
      ...totals,
      paymentStatus: 'PENDING' as const,
      invoiceStatus: 'ACTIVE' as const,
      source: 'MANUAL' as const,
      notes: body.notes || undefined,
    };

    // Two invoices created at the same moment can compute the same number;
    // the unique index rejects one and it retries with the next number.
    for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
      const invoiceNumber = await generateInvoiceNumber(settings.invoicePrefix || 'NAVKA', invoiceDate);
      try {
        const invoice = await Invoice.create({ ...invoiceData, invoiceNumber });
        res.status(201).json({ success: true, invoice });
        return;
      } catch (err: any) {
        if (err?.code === 11000 && err?.keyPattern?.invoiceNumber) continue;
        throw err;
      }
    }
    throw new AppError('Could not allocate a unique invoice number. Please retry.', 409);
  } catch (error) {
    next(error);
  }
};

export const downloadInvoicePdf = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError('Invalid invoice ID.', 400);
    }

    const invoice = await Invoice.findById(id).lean();
    if (!invoice) {
      throw new AppError('Invoice not found.', 404);
    }
    const settings = await BusinessSettings.findOne().select('bankDetails').lean();

    const filename = `${invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    generateInvoicePdf(invoice, settings?.bankDetails, res);
  } catch (error) {
    next(error);
  }
};

export const updateInvoiceSchema = z
  .object({
    invoiceStatus: z.enum(INVOICE_STATUSES).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.invoiceStatus !== undefined || d.notes !== undefined, {
    message: 'Provide invoiceStatus or notes to update',
  });

// PUT /api/invoices/:id — Admin only. Cancel a manual invoice or edit its notes.
export const updateInvoice = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      throw new AppError('Invalid invoice ID.', 400);
    }
    const body = req.body as z.infer<typeof updateInvoiceSchema>;

    const invoice = await Invoice.findById(id);
    if (!invoice) {
      throw new AppError('Invoice not found.', 404);
    }
    // Shopify invoices are overwritten on every sync; change them in Shopify instead.
    if (invoice.source === 'SHOPIFY') {
      throw new AppError('Shopify invoices are managed in Shopify. Update the order there and re-sync.', 400);
    }
    // A cancelled GST invoice is final; issue a new invoice instead of reactivating it.
    if (invoice.invoiceStatus === 'CANCELLED' && body.invoiceStatus === 'ACTIVE') {
      throw new AppError('Cancelled invoices cannot be reactivated. Create a new invoice instead.', 400);
    }

    if (body.invoiceStatus) invoice.invoiceStatus = body.invoiceStatus;
    if (body.notes !== undefined) invoice.notes = body.notes || undefined;
    await invoice.save();

    res.status(200).json({ success: true, invoice });
  } catch (error) {
    next(error);
  }
};
