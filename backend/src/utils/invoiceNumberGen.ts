import Invoice from '../models/Invoice';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Next sequential manual invoice number for the invoice month:
 * `<PREFIX>-YYYYMM-XXXX` (e.g. NAVKA-202610-0007). The sequence restarts each month.
 * Uniqueness is guaranteed by the unique index on invoiceNumber; callers retry on
 * a duplicate-key error when two invoices are created at the same moment.
 */
export const generateInvoiceNumber = async (prefix: string, invoiceDate: Date = new Date()): Promise<string> => {
  const period = `${invoiceDate.getFullYear()}${String(invoiceDate.getMonth() + 1).padStart(2, '0')}`;
  const base = `${prefix}-${period}-`;

  const existing = await Invoice.find({ invoiceNumber: new RegExp(`^${escapeRegex(base)}\\d+$`) })
    .select('invoiceNumber')
    .lean();

  // Compare numerically: a string sort would put 10000 before 9999.
  const last = existing.reduce((max, inv) => Math.max(max, parseInt(inv.invoiceNumber.slice(base.length), 10) || 0), 0);
  return `${base}${String(last + 1).padStart(4, '0')}`;
};
