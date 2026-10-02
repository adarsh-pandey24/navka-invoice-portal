import { convertAmountToWords } from '../utils/numberToWords';
import { SupplyType } from '../utils/gstState';

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineItemInput {
  productId?: string;
  productName: string;
  hsnSac: string;
  quantity: number;
  unitPrice: number;
  discount: number; // percent (0-100)
  gstRate: number; // percent
}

export interface CalculatedLineItem {
  productId?: string;
  productName: string;
  hsnSac: string;
  quantity: number;
  unitPrice: number;
  discount: number; // rupee amount, as stored on Invoice.items
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
}

export interface InvoiceTotals {
  items: CalculatedLineItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  totalGST: number;
  roundOff: number;
  grandTotal: number;
  amountInWords: string;
}

/**
 * Authoritative GST invoice maths (plan section H, formulas 1-11).
 * Each line is rounded to paise; invoice totals are sums of the rounded lines
 * so the printed table always adds up.
 */
export const calculateInvoice = (lines: LineItemInput[]): InvoiceTotals => {
  const items = lines.map((line): CalculatedLineItem => {
    const gross = line.unitPrice * line.quantity;
    const discountAmount = round2((gross * line.discount) / 100);
    const taxableAmount = round2(gross - discountAmount);
    const gstAmount = round2((taxableAmount * line.gstRate) / 100);
    return {
      productId: line.productId,
      productName: line.productName,
      hsnSac: line.hsnSac,
      quantity: line.quantity,
      unitPrice: round2(line.unitPrice),
      discount: discountAmount,
      taxableAmount,
      gstRate: line.gstRate,
      gstAmount,
      totalAmount: round2(taxableAmount + gstAmount),
    };
  });

  const sum = (pick: (i: CalculatedLineItem) => number) => round2(items.reduce((s, i) => s + pick(i), 0));

  const subtotal = sum((i) => i.unitPrice * i.quantity);
  const discount = sum((i) => i.discount);
  const taxableAmount = sum((i) => i.taxableAmount);
  const totalGST = sum((i) => i.gstAmount);
  const unrounded = round2(taxableAmount + totalGST);
  const grandTotal = Math.round(unrounded);
  const roundOff = round2(grandTotal - unrounded);

  return {
    items,
    subtotal,
    discount,
    taxableAmount,
    totalGST,
    roundOff,
    grandTotal,
    amountInWords: convertAmountToWords(grandTotal),
  };
};

export interface TaxSplit {
  cgst: number;
  sgst: number;
  igst: number;
}

// Intra-state: GST split equally into CGST + SGST. Inter-state: all IGST.
export const splitGst = (gstAmount: number, supplyType: SupplyType): TaxSplit => {
  if (supplyType === 'INTER_STATE') {
    return { cgst: 0, sgst: 0, igst: round2(gstAmount) };
  }
  const cgst = round2(gstAmount / 2);
  return { cgst, sgst: round2(gstAmount - cgst), igst: 0 };
};

export interface HsnTaxRow extends TaxSplit {
  hsnSac: string;
  gstRate: number;
  taxableAmount: number;
  gstAmount: number;
}

// HSN/SAC + rate wise tax summary, as printed on GST invoices.
export const summarizeByHsn = (
  items: Array<Pick<CalculatedLineItem, 'hsnSac' | 'gstRate' | 'taxableAmount' | 'gstAmount'>>,
  supplyType: SupplyType
): HsnTaxRow[] => {
  const rows = new Map<string, { hsnSac: string; gstRate: number; taxableAmount: number; gstAmount: number }>();
  for (const item of items) {
    const key = `${item.hsnSac}|${item.gstRate}`;
    const row = rows.get(key) || { hsnSac: item.hsnSac, gstRate: item.gstRate, taxableAmount: 0, gstAmount: 0 };
    row.taxableAmount = round2(row.taxableAmount + item.taxableAmount);
    row.gstAmount = round2(row.gstAmount + item.gstAmount);
    rows.set(key, row);
  }
  return Array.from(rows.values()).map((row) => ({ ...row, ...splitGst(row.gstAmount, supplyType) }));
};
