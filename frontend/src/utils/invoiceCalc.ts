import { SupplyType } from './gstState';

// Mirrors backend/src/services/calculationService.ts for the live preview.
// The server recalculates on save; its numbers are authoritative.

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface LineInput {
  productName: string;
  hsnSac: string;
  quantity: number;
  unitPrice: number;
  discount: number; // percent
  gstRate: number;
}

export interface CalculatedLine extends LineInput {
  discountAmount: number;
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
}

export interface InvoiceTotals {
  items: CalculatedLine[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  totalGST: number;
  roundOff: number;
  grandTotal: number;
}

export const calculateInvoice = (lines: LineInput[]): InvoiceTotals => {
  const items = lines.map((line): CalculatedLine => {
    const gross = line.unitPrice * line.quantity;
    const discountAmount = round2((gross * line.discount) / 100);
    const taxableAmount = round2(gross - discountAmount);
    const gstAmount = round2((taxableAmount * line.gstRate) / 100);
    return { ...line, discountAmount, taxableAmount, gstAmount, totalAmount: round2(taxableAmount + gstAmount) };
  });

  const sum = (pick: (i: CalculatedLine) => number) => round2(items.reduce((s, i) => s + pick(i), 0));
  const subtotal = sum((i) => round2(i.unitPrice) * i.quantity);
  const discount = sum((i) => i.discountAmount);
  const taxableAmount = sum((i) => i.taxableAmount);
  const totalGST = sum((i) => i.gstAmount);
  const unrounded = round2(taxableAmount + totalGST);
  const grandTotal = Math.round(unrounded);

  return { items, subtotal, discount, taxableAmount, totalGST, roundOff: round2(grandTotal - unrounded), grandTotal };
};

export const splitGst = (gstAmount: number, supplyType: SupplyType) => {
  if (supplyType === 'INTER_STATE') return { cgst: 0, sgst: 0, igst: round2(gstAmount) };
  const cgst = round2(gstAmount / 2);
  return { cgst, sgst: round2(gstAmount - cgst), igst: 0 };
};

const units = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const belowThousand = (n: number): string => {
  let str = '';
  if (n >= 100) {
    str += `${units[Math.floor(n / 100)]} Hundred `;
    n %= 100;
  }
  if (n > 0) {
    str += n < 20 ? `${units[n]} ` : `${tens[Math.floor(n / 10)]} ${n % 10 ? `${units[n % 10]} ` : ''}`;
  }
  return str;
};

// Same output as backend convertAmountToWords for whole-rupee grand totals.
export const amountInWords = (amount: number): string => {
  const rupees = Math.floor(Math.abs(amount));
  if (rupees === 0) return 'Rupees Zero Only';
  const crore = Math.floor(rupees / 10000000);
  const lakh = Math.floor((rupees % 10000000) / 100000);
  const thousand = Math.floor((rupees % 100000) / 1000);
  const rest = rupees % 1000;
  let result = '';
  if (crore) result += `${belowThousand(crore)}Crore `;
  if (lakh) result += `${belowThousand(lakh)}Lakh `;
  if (thousand) result += `${belowThousand(thousand)}Thousand `;
  if (rest) result += belowThousand(rest);
  return `Rupees ${result.trim()} Only`.replace(/\s+/g, ' ');
};
