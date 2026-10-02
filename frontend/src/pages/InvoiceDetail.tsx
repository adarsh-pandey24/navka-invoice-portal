import React, { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Printer, AlertCircle, Ban, Pencil, Wallet } from 'lucide-react';
import apiClient from '../services/api';
import { Invoice, Payment } from '../types';
import { formatAddress, formatCurrency, formatDate } from '../utils/format';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';
import { downloadInvoicePdf } from '../utils/pdf';
import { useAuth } from '../context/AuthContext';
import { Field, Modal, inputClass, primaryButton, secondaryButton } from '../components/UI/Modal';

interface InvoiceDetailResponse {
  success: boolean;
  invoice: Invoice;
  payments: Payment[];
  summary: {
    productSubtotal: number;
    discount: number;
    taxableAmount: number;
    totalGST: number;
    shippingCharges: number;
    grandTotal: number;
    roundOff?: number;
    amountInWords?: string;
    amountPaid: number;
    balanceDue: number;
  };
}

const isShippingItem = (name: string, hsn: string) =>
  name.toLowerCase().startsWith('shipping') || hsn === '996812';

interface GstSummaryRow {
  hsnSac: string;
  gstRate: number;
  taxableAmount: number;
  gstAmount: number;
}

// Group line items by HSN/SAC + GST rate for the tax breakdown table.
const buildGstSummary = (items: Invoice['items']): GstSummaryRow[] => {
  const rows = new Map<string, GstSummaryRow>();
  for (const item of items) {
    const key = `${item.hsnSac}|${item.gstRate}`;
    const row = rows.get(key) || { hsnSac: item.hsnSac, gstRate: item.gstRate, taxableAmount: 0, gstAmount: 0 };
    row.taxableAmount += item.taxableAmount || 0;
    row.gstAmount += item.gstAmount || 0;
    rows.set(key, row);
  }
  return Array.from(rows.values());
};

export const InvoiceDetailPage: React.FC = () => {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';

  const [data, setData] = useState<InvoiceDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.get(`/invoices/${id}`);
      if (res.data?.success) {
        setData(res.data);
      } else {
        setError('Failed to load invoice.');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Error fetching invoice.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (autoPrint && data && !isLoading && !error) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [autoPrint, data, isLoading, error]);

  const [isDownloading, setIsDownloading] = useState(false);
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [dialog, setDialog] = useState<'cancel' | 'notes' | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const updateInvoice = async (body: { invoiceStatus?: 'CANCELLED'; notes?: string }, success: string) => {
    if (!data?.invoice) return;
    setIsSaving(true);
    setDialogError(null);
    try {
      await apiClient.put(`/invoices/${data.invoice._id}`, body);
      setDialog(null);
      setNotice(success);
      setTimeout(() => setNotice(null), 4000);
      fetchDetail();
    } catch (err: any) {
      setDialogError(err.response?.data?.message || 'Could not update the invoice.');
    } finally {
      setIsSaving(false);
    }
  };

  const downloadPdf = async () => {
    if (!data?.invoice) return;
    setIsDownloading(true);
    try {
      await downloadInvoicePdf(data.invoice._id, data.invoice.invoiceNumber);
    } catch {
      setNotice('Could not download the PDF. Please try again.');
      setTimeout(() => setNotice(null), 4000);
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center text-sm text-slate-400">Loading invoice...</div>
    );
  }

  if (error || !data?.invoice) {
    return (
      <div className="max-w-xl mx-auto bg-white border border-rose-200 rounded-xl p-6 text-center">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
        <p className="text-sm font-medium text-rose-700">{error || 'Invoice not found.'}</p>
        <button onClick={fetchDetail} className="mt-4 text-xs font-semibold underline">
          Retry
        </button>
        <div className="mt-3">
          <Link to="/invoices" className="text-xs text-slate-500 hover:text-slate-800">
            Back to invoices
          </Link>
        </div>
      </div>
    );
  }

  const { invoice, payments, summary } = data;
  const gstSummary = buildGstSummary(invoice.items);
  const business = invoice.businessDetails;
  const refund = invoice.refundDetails;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link
            to="/invoices"
            className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white bg-white"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{invoice.invoiceNumber}</h1>
            <p className="text-sm text-slate-500">Invoice detail</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Admin-only actions; CA stays view/download/print only. */}
          {isAdmin && invoice.invoiceStatus === 'ACTIVE' && invoice.paymentStatus !== 'REFUNDED' && summary.balanceDue > 0 && (
            <Link to={`/payments?record=${invoice._id}`} className={secondaryButton}>
              <Wallet className="w-4 h-4" />
              Record payment
            </Link>
          )}
          {isAdmin && invoice.source === 'MANUAL' && (
            <button
              onClick={() => {
                setNotesDraft(invoice.notes || '');
                setDialogError(null);
                setDialog('notes');
              }}
              className={secondaryButton}
            >
              <Pencil className="w-4 h-4" />
              Edit notes
            </button>
          )}
          {isAdmin && invoice.source === 'MANUAL' && invoice.invoiceStatus === 'ACTIVE' && (
            <button
              onClick={() => {
                setDialogError(null);
                setDialog('cancel');
              }}
              className={`${secondaryButton} text-rose-700`}
            >
              <Ban className="w-4 h-4" />
              Cancel invoice
            </button>
          )}
          <button
            onClick={downloadPdf}
            disabled={isDownloading}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold border border-slate-200 rounded-lg bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isDownloading ? 'Downloading…' : 'Download PDF'}
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>

      {notice && (
        <div className="bg-slate-50 border border-slate-200 text-slate-700 p-3 rounded-xl text-sm print:hidden">
          {notice}
        </div>
      )}

      {business && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Seller</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{business.name}</p>
              <p className="text-slate-700 mt-0.5">{business.address || '—'}</p>
            </div>
            <div>
              <p className="text-slate-500">GSTIN</p>
              <p className="font-medium text-slate-900 font-mono">{business.gstin || '—'}</p>
            </div>
            <div>
              <p className="text-slate-500">Contact</p>
              <p className="text-slate-800">{[business.phone, business.email].filter(Boolean).join(' · ') || '—'}</p>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Invoice</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Invoice Number</dt>
              <dd className="font-semibold text-slate-900 mt-0.5">{invoice.invoiceNumber}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Invoice Date</dt>
              <dd className="font-medium text-slate-900 mt-0.5">{formatDate(invoice.invoiceDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Shopify Order ID</dt>
              <dd className="font-medium text-slate-900 mt-0.5">
                {invoice.shopifyOrderId || invoice.shopifyOrderNumber || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Invoice Status</dt>
              <dd className="mt-1">
                <StatusBadge label={invoice.invoiceStatus} kind="invoice" />
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Due Date</dt>
              <dd className="font-medium text-slate-900 mt-0.5">{formatDate(invoice.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Source</dt>
              <dd className="font-medium text-slate-900 mt-0.5">{invoice.source}</dd>
            </div>
          </dl>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Customer</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-slate-500">Name</dt>
              <dd className="font-semibold text-slate-900">{invoice.customer?.name || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Billing Address</dt>
              <dd className="text-slate-800">{formatAddress(invoice.customer?.billingAddress)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Shipping Address</dt>
              <dd className="text-slate-800">{formatAddress(invoice.customer?.shippingAddress)}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-slate-500">GSTIN</dt>
                <dd className="font-medium text-slate-900">{invoice.customer?.gstin || '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Contact</dt>
                <dd className="text-slate-800">
                  {[invoice.customer?.phone, invoice.customer?.email].filter(Boolean).join(' · ') || '—'}
                </dd>
              </div>
            </div>
          </dl>
        </section>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[800px]">
            <thead>
              <tr className="bg-slate-50/80 text-xs uppercase text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-4">HSN/SAC</th>
                <th className="py-3 px-4 text-right">Qty</th>
                <th className="py-3 px-4 text-right">Unit Price</th>
                <th className="py-3 px-4 text-right">Discount</th>
                <th className="py-3 px-4 text-right">Taxable Amount</th>
                <th className="py-3 px-4 text-right">GST</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoice.items.map((item, idx) => (
                <tr key={item._id || idx}>
                  <td className="py-3 px-4 font-medium text-slate-900">
                    {item.productName}
                    {isShippingItem(item.productName, item.hsnSac) && (
                      <span className="ml-2 text-[10px] uppercase text-slate-500">Shipping</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-700">{item.hsnSac}</td>
                  <td className="py-3 px-4 text-right">{item.quantity}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(item.unitPrice)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(item.discount)}</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(item.taxableAmount)}</td>
                  <td className="py-3 px-4 text-right">
                    {formatCurrency(item.gstAmount)}
                    <span className="block text-[10px] text-slate-400">{item.gstRate}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">GST Breakdown (HSN/SAC)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[560px]">
            <thead>
              <tr className="bg-slate-50/80 text-xs uppercase text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4">HSN/SAC</th>
                <th className="py-3 px-4 text-right">GST Rate</th>
                <th className="py-3 px-4 text-right">Taxable Amount</th>
                <th className="py-3 px-4 text-right">GST Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gstSummary.map((row) => (
                <tr key={`${row.hsnSac}-${row.gstRate}`}>
                  <td className="py-3 px-4 font-mono text-xs text-slate-700">{row.hsnSac}</td>
                  <td className="py-3 px-4 text-right">{row.gstRate}%</td>
                  <td className="py-3 px-4 text-right">{formatCurrency(row.taxableAmount)}</td>
                  <td className="py-3 px-4 text-right text-indigo-700 font-medium">{formatCurrency(row.gstAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Payments</h2>
            <StatusBadge label={invoice.paymentStatus} kind="payment" />
          </div>
          {payments.length === 0 ? (
            <p className="text-sm text-slate-400">No payments recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {payments.map((p) => (
                <li key={p._id} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {p.paymentMethod} · {p.paymentSource}
                    </p>
                    <p className="text-xs text-slate-500 break-all">
                      {formatDate(p.paymentDate)}
                      {p.referenceId ? ` · Ref: ${p.referenceId}` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-slate-900">{formatCurrency(p.amount)}</p>
                    <p className="text-[10px] uppercase text-slate-500">{p.paymentStatus}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {refund?.isRefunded && (
            <div className="mt-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm">
              <p className="font-semibold text-rose-800">Refunded {formatCurrency(refund.refundAmount)}</p>
              <p className="text-xs text-rose-700 mt-0.5">
                {formatDate(refund.refundDate)}
                {refund.refundReason ? ` · ${refund.refundReason}` : ''}
              </p>
            </div>
          )}
          {invoice.notes && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Notes</p>
              <p className="text-sm text-slate-700 mt-1">{invoice.notes}</p>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="font-medium">{formatCurrency(summary.productSubtotal || invoice.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Discount</dt>
              <dd className="font-medium">{formatCurrency(summary.discount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Taxable Amount</dt>
              <dd className="font-medium">{formatCurrency(summary.taxableAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Total GST</dt>
              <dd className="font-medium text-indigo-700">{formatCurrency(summary.totalGST)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Shipping / Other Charges</dt>
              <dd className="font-medium">{formatCurrency(summary.shippingCharges || 0)}</dd>
            </div>
            {invoice.roundOff ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">Round off</dt>
                <dd className="font-medium">{formatCurrency(invoice.roundOff)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <dt className="font-semibold text-slate-900">Grand Total</dt>
              <dd className="font-bold text-slate-900">{formatCurrency(summary.grandTotal)}</dd>
            </div>
            {invoice.amountInWords && (
              <p className="text-xs text-slate-500 pt-1">{invoice.amountInWords}</p>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <dt className="text-slate-500">Amount Paid</dt>
              <dd className="font-medium text-emerald-700">{formatCurrency(summary.amountPaid)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Balance Due</dt>
              <dd className="font-semibold text-slate-900">{formatCurrency(summary.balanceDue)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {dialog === 'cancel' && (
        <Modal
          title={`Cancel ${invoice.invoiceNumber}?`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button onClick={() => setDialog(null)} className={secondaryButton}>
                Keep invoice
              </button>
              <button
                onClick={() => updateInvoice({ invoiceStatus: 'CANCELLED' }, 'Invoice cancelled.')}
                disabled={isSaving}
                className={`${primaryButton} bg-rose-600 hover:bg-rose-700`}
              >
                {isSaving ? 'Cancelling…' : 'Cancel invoice'}
              </button>
            </>
          }
        >
          <div className="space-y-2 text-sm text-slate-700">
            {dialogError && <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{dialogError}</p>}
            <p>A cancelled invoice cannot be reactivated. It is excluded from sales reports and cannot receive payments.</p>
            {summary.amountPaid > 0 && (
              <p className="text-amber-700">
                {formatCurrency(summary.amountPaid)} has already been received against this invoice. Refund or re-assign it separately.
              </p>
            )}
          </div>
        </Modal>
      )}

      {dialog === 'notes' && (
        <Modal
          title="Edit notes"
          onClose={() => setDialog(null)}
          footer={
            <>
              <button onClick={() => setDialog(null)} className={secondaryButton}>
                Cancel
              </button>
              <button onClick={() => updateInvoice({ notes: notesDraft.trim() }, 'Notes updated.')} disabled={isSaving} className={primaryButton}>
                {isSaving ? 'Saving…' : 'Save notes'}
              </button>
            </>
          }
        >
          {dialogError && <p className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3">{dialogError}</p>}
          <Field label="Notes">
            <textarea value={notesDraft} maxLength={1000} rows={4} onChange={(e) => setNotesDraft(e.target.value)} className={inputClass()} />
          </Field>
        </Modal>
      )}
    </div>
  );
};
