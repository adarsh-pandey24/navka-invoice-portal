import { Types } from 'mongoose';
import Invoice, { PaymentStatus } from '../models/Invoice';
import Payment from '../models/Payment';
import { round2 } from './calculationService';

// Sum of COMPLETED payments (online + offline) recorded against an invoice.
export const getAmountPaid = async (invoiceId: Types.ObjectId | string): Promise<number> => {
  const [row] = await Payment.aggregate([
    { $match: { invoiceId: new Types.ObjectId(String(invoiceId)), paymentStatus: 'COMPLETED' } },
    { $group: { _id: null, paid: { $sum: '$amount' } } },
  ]);
  return round2(row?.paid || 0);
};

/**
 * Derives the invoice paymentStatus from its payments and saves it:
 * paid >= grand total -> PAID, paid > 0 -> PARTIAL, otherwise PENDING (FAILED is kept).
 * REFUNDED invoices are left alone; refunds are owned by the Shopify sync.
 */
export const reconcileInvoicePaymentStatus = async (
  invoiceId: Types.ObjectId | string
): Promise<{ paymentStatus: PaymentStatus; amountPaid: number; balanceDue: number } | null> => {
  const invoice = await Invoice.findById(invoiceId).select('grandTotal paymentStatus');
  if (!invoice) return null;

  const amountPaid = await getAmountPaid(invoice._id);
  const balanceDue = round2(Math.max(0, invoice.grandTotal - amountPaid));

  let next: PaymentStatus = invoice.paymentStatus;
  if (invoice.paymentStatus !== 'REFUNDED') {
    if (amountPaid > 0 && balanceDue <= 0) next = 'PAID';
    else if (amountPaid > 0) next = 'PARTIAL';
    else next = invoice.paymentStatus === 'FAILED' ? 'FAILED' : 'PENDING';
  }

  if (next !== invoice.paymentStatus) {
    invoice.paymentStatus = next;
    await invoice.save();
  }
  return { paymentStatus: next, amountPaid, balanceDue };
};
