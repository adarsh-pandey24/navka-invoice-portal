import React from 'react';
import { BusinessSettings, CustomerInfo } from '../../types';
import { formatAddress, formatCurrency, formatDate } from '../../utils/format';
import { InvoiceTotals, amountInWords, splitGst } from '../../utils/invoiceCalc';
import { SupplyType } from '../../utils/gstState';

interface InvoicePreviewProps {
  business: BusinessSettings | null;
  customer: CustomerInfo;
  totals: InvoiceTotals;
  supplyType: SupplyType;
  placeOfSupply?: string;
  invoiceDate?: string;
  dueDate?: string;
  notes?: string;
}

// Printable-style preview of a draft invoice, laid out like the generated PDF.
export const InvoicePreview: React.FC<InvoicePreviewProps> = ({
  business,
  customer,
  totals,
  supplyType,
  placeOfSupply,
  invoiceDate,
  dueDate,
  notes,
}) => {
  const split = splitGst(totals.totalGST, supplyType);

  return (
    <div className="bg-white text-slate-900 text-sm space-y-5">
      <div className="flex flex-col sm:flex-row justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <p className="text-lg font-bold">{business?.businessName || '—'}</p>
          <p className="text-xs text-slate-600 max-w-sm">{business?.address}</p>
          <p className="text-xs text-slate-600">GSTIN: {business?.gstin || '—'}</p>
        </div>
        <div className="sm:text-right text-xs text-slate-600 space-y-0.5">
          <p className="text-base font-bold text-slate-900">TAX INVOICE</p>
          <p>Invoice No: <span className="italic">assigned on save</span></p>
          <p>Invoice Date: {formatDate(invoiceDate)}</p>
          <p>Due Date: {formatDate(dueDate)}</p>
          {placeOfSupply && <p>Place of Supply: {placeOfSupply}</p>}
          <p>Supply: {supplyType === 'INTRA_STATE' ? 'Intra-state (CGST + SGST)' : 'Inter-state (IGST)'}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
        <div>
          <p className="font-semibold text-slate-500 uppercase tracking-wide">Bill to</p>
          <p className="font-semibold text-sm text-slate-900 mt-1">{customer.name || '—'}</p>
          <p className="text-slate-700">{formatAddress(customer.billingAddress)}</p>
          {customer.gstin && <p className="text-slate-700">GSTIN: {customer.gstin}</p>}
          <p className="text-slate-700">{[customer.phone, customer.email].filter(Boolean).join(' · ')}</p>
        </div>
        <div>
          <p className="font-semibold text-slate-500 uppercase tracking-wide">Ship to</p>
          <p className="font-semibold text-sm text-slate-900 mt-1">{customer.name || '—'}</p>
          <p className="text-slate-700">{formatAddress(customer.shippingAddress || customer.billingAddress)}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border border-slate-200 min-w-[640px]">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">Item</th>
              <th className="p-2 text-left">HSN/SAC</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Rate</th>
              <th className="p-2 text-right">Discount</th>
              <th className="p-2 text-right">Taxable</th>
              <th className="p-2 text-right">GST</th>
              <th className="p-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {totals.items.map((item, i) => (
              <tr key={i}>
                <td className="p-2">{i + 1}</td>
                <td className="p-2">{item.productName || '—'}</td>
                <td className="p-2 font-mono">{item.hsnSac || '—'}</td>
                <td className="p-2 text-right">{item.quantity}</td>
                <td className="p-2 text-right">{formatCurrency(item.unitPrice)}</td>
                <td className="p-2 text-right">{formatCurrency(item.discountAmount)}</td>
                <td className="p-2 text-right">{formatCurrency(item.taxableAmount)}</td>
                <td className="p-2 text-right">
                  {formatCurrency(item.gstAmount)}
                  <span className="block text-[10px] text-slate-400">{item.gstRate}%</span>
                </td>
                <td className="p-2 text-right font-medium">{formatCurrency(item.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="text-xs space-y-3 max-w-sm">
          <div>
            <p className="font-semibold text-slate-500 uppercase tracking-wide">Amount in words</p>
            <p className="text-slate-800 mt-0.5">{amountInWords(totals.grandTotal)}</p>
          </div>
          {notes && (
            <div>
              <p className="font-semibold text-slate-500 uppercase tracking-wide">Notes</p>
              <p className="text-slate-800 mt-0.5 whitespace-pre-line">{notes}</p>
            </div>
          )}
          {business?.bankDetails?.bankName && (
            <div>
              <p className="font-semibold text-slate-500 uppercase tracking-wide">Bank details</p>
              <p className="text-slate-800 mt-0.5">
                {business.bankDetails.bankName} · A/c {business.bankDetails.accountNumber} · IFSC{' '}
                {business.bankDetails.ifscCode}
              </p>
            </div>
          )}
        </div>
        <dl className="w-full sm:w-64 text-xs space-y-1.5">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatCurrency(totals.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>- {formatCurrency(totals.discount)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Taxable Amount</dt><dd>{formatCurrency(totals.taxableAmount)}</dd></div>
          {supplyType === 'INTRA_STATE' ? (
            <>
              <div className="flex justify-between"><dt className="text-slate-500">CGST</dt><dd>{formatCurrency(split.cgst)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">SGST</dt><dd>{formatCurrency(split.sgst)}</dd></div>
            </>
          ) : (
            <div className="flex justify-between"><dt className="text-slate-500">IGST</dt><dd>{formatCurrency(split.igst)}</dd></div>
          )}
          {totals.roundOff !== 0 && (
            <div className="flex justify-between"><dt className="text-slate-500">Round Off</dt><dd>{formatCurrency(totals.roundOff)}</dd></div>
          )}
          <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold">
            <dt>Grand Total</dt>
            <dd>{formatCurrency(totals.grandTotal)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
};
