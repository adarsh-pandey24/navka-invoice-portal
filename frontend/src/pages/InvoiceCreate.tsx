import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Eye, Plus, Trash2, X } from 'lucide-react';
import apiClient from '../services/api';
import { BusinessSettings, CustomerAddress, CustomerInfo } from '../types';
import { formatCurrency } from '../utils/format';
import { GST_RATES, calculateInvoice, splitGst } from '../utils/invoiceCalc';
import { INDIAN_STATES, getPlaceOfSupply, getSupplyType } from '../utils/gstState';
import { InvoicePreview } from '../components/InvoicePreview/InvoicePreview';

interface ProductOption {
  _id: string;
  name: string;
  hsnSac: string;
  gstRate: number;
  unitPrice: number;
}

interface LineDraft {
  key: number;
  productId?: string;
  productName: string;
  hsnSac: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  gstRate: number;
}

type Errors = Record<string, string>;

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HSN_REGEX = /^\d{4,8}$/;

const emptyAddress = (): CustomerAddress => ({ street: '', city: '', state: '', pincode: '', country: 'India' });

const toLocalDateInput = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let nextLineKey = 1;
const emptyLine = (): LineDraft => ({
  key: nextLineKey++,
  productName: '',
  hsnSac: '',
  quantity: '1',
  unitPrice: '',
  discount: '0',
  gstRate: 18,
});

const toNumber = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const hasAddress = (a: CustomerAddress) => Boolean(a.street || a.city || a.state || a.pincode);

const inputCls = (error?: string) =>
  `mt-1 w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-slate-800 bg-white ${
    error ? 'border-rose-400' : 'border-slate-200'
  }`;

const Field: React.FC<{ label: string; error?: string; required?: boolean; children: React.ReactNode; className?: string }> = ({
  label,
  error,
  required,
  children,
  className,
}) => (
  <label className={`block ${className || ''}`}>
    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {label}
      {required && <span className="text-rose-500"> *</span>}
    </span>
    {children}
    {error && <span className="block text-xs text-rose-600 mt-1">{error}</span>}
  </label>
);

export const InvoiceCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [customer, setCustomer] = useState({ name: '', email: '', phone: '', gstin: '' });
  const [billing, setBilling] = useState<CustomerAddress>(emptyAddress());
  const [shipping, setShipping] = useState<CustomerAddress>(emptyAddress());
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [invoiceDate, setInvoiceDate] = useState(toLocalDateInput(new Date()));
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get('/settings')
      .then((res) => setBusiness(res.data?.settings || null))
      .catch(() => setBusiness(null));
    apiClient
      .get('/hsn-mappings')
      .then((res) => setProducts(res.data?.mappings || []))
      .catch(() => setProducts([]));
  }, []);

  const totals = useMemo(
    () =>
      calculateInvoice(
        lines.map((l) => ({
          productName: l.productName,
          hsnSac: l.hsnSac,
          quantity: toNumber(l.quantity),
          unitPrice: toNumber(l.unitPrice),
          discount: toNumber(l.discount),
          gstRate: l.gstRate,
        }))
      ),
    [lines]
  );

  const shippingAddress = sameAsBilling ? billing : shipping;
  const placeOfSupplyInput = { gstin: customer.gstin.trim().toUpperCase(), state: shippingAddress.state || billing.state };
  const supplyType = getSupplyType(business?.gstin, placeOfSupplyInput);
  const placeOfSupply = getPlaceOfSupply(placeOfSupplyInput);
  const split = splitGst(totals.totalGST, supplyType);

  const previewCustomer: CustomerInfo = {
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    gstin: customer.gstin.trim().toUpperCase(),
    billingAddress: billing,
    shippingAddress,
  };

  const updateLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const pickProduct = (key: number, productId: string) => {
    const product = products.find((p) => p._id === productId);
    if (!product) {
      updateLine(key, { productId: undefined });
      return;
    }
    updateLine(key, {
      productId: product._id,
      productName: product.name,
      // Unmapped products need a real HSN/SAC before they can be invoiced.
      hsnSac: product.hsnSac === 'UNMAPPED' ? '' : product.hsnSac,
      unitPrice: String(product.unitPrice ?? ''),
      gstRate: (GST_RATES as readonly number[]).includes(product.gstRate) ? product.gstRate : 18,
    });
  };

  const validate = (): Errors => {
    const e: Errors = {};
    if (!customer.name.trim()) e['customer.name'] = 'Customer name is required';
    if (customer.email.trim() && !EMAIL_REGEX.test(customer.email.trim())) e['customer.email'] = 'Invalid email';
    if (customer.gstin.trim() && !GSTIN_REGEX.test(customer.gstin.trim().toUpperCase()))
      e['customer.gstin'] = 'Invalid GSTIN (15 characters, e.g. 27AAACP1234Q1Z5)';
    if (billing.pincode && !/^\d{6}$/.test(billing.pincode)) e['billing.pincode'] = 'Pincode must be 6 digits';
    if (!sameAsBilling && shipping.pincode && !/^\d{6}$/.test(shipping.pincode))
      e['shipping.pincode'] = 'Pincode must be 6 digits';
    if (dueDate && invoiceDate && dueDate < invoiceDate) e.dueDate = 'Due date cannot be before invoice date';
    if (!lines.length) e.items = 'Add at least one line item';
    lines.forEach((l) => {
      const p = `line.${l.key}`;
      if (!l.productName.trim()) e[`${p}.productName`] = 'Required';
      if (!HSN_REGEX.test(l.hsnSac.trim())) e[`${p}.hsnSac`] = '4-8 digits';
      const qty = Number(l.quantity);
      if (!Number.isInteger(qty) || qty < 1) e[`${p}.quantity`] = 'Whole number ≥ 1';
      if (l.unitPrice.trim() === '' || !Number.isFinite(Number(l.unitPrice)) || Number(l.unitPrice) < 0)
        e[`${p}.unitPrice`] = 'Price ≥ 0';
      const disc = Number(l.discount || 0);
      if (!Number.isFinite(disc) || disc < 0 || disc > 100) e[`${p}.discount`] = '0-100';
    });
    return e;
  };

  const openPreview = () => {
    const e = validate();
    setErrors(e);
    setServerError(null);
    if (Object.keys(e).length === 0) setShowPreview(true);
  };

  const save = async () => {
    setIsSaving(true);
    setServerError(null);
    const address = (a: CustomerAddress) => (hasAddress(a) ? a : undefined);
    const payload = {
      customer: {
        name: customer.name.trim(),
        email: customer.email.trim(),
        phone: customer.phone.trim(),
        gstin: customer.gstin.trim().toUpperCase(),
        billingAddress: address(billing),
        shippingAddress: address(shippingAddress),
      },
      items: lines.map((l) => ({
        ...(l.productId && { productId: l.productId }),
        productName: l.productName.trim(),
        hsnSac: l.hsnSac.trim(),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discount: Number(l.discount || 0),
        gstRate: l.gstRate,
      })),
      invoiceDate,
      ...(dueDate && { dueDate }),
      ...(notes.trim() && { notes: notes.trim() }),
    };
    try {
      const res = await apiClient.post('/invoices', payload);
      navigate(`/invoices/${res.data.invoice._id}`);
    } catch (err: any) {
      setServerError(err.response?.data?.message || 'Could not create invoice. Please try again.');
      setShowPreview(false);
    } finally {
      setIsSaving(false);
    }
  };

  const addressFields = (
    value: CustomerAddress,
    onChange: (a: CustomerAddress) => void,
    errorPrefix: string
  ) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Street" className="sm:col-span-2">
        <input value={value.street} onChange={(e) => onChange({ ...value, street: e.target.value })} className={inputCls()} />
      </Field>
      <Field label="City">
        <input value={value.city} onChange={(e) => onChange({ ...value, city: e.target.value })} className={inputCls()} />
      </Field>
      <Field label="State">
        <select value={value.state} onChange={(e) => onChange({ ...value, state: e.target.value })} className={inputCls()}>
          <option value="">Select state</option>
          {INDIAN_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pincode" error={errors[`${errorPrefix}.pincode`]}>
        <input
          value={value.pincode}
          inputMode="numeric"
          maxLength={6}
          onChange={(e) => onChange({ ...value, pincode: e.target.value })}
          className={inputCls(errors[`${errorPrefix}.pincode`])}
        />
      </Field>
      <Field label="Country">
        <input value={value.country} onChange={(e) => onChange({ ...value, country: e.target.value })} className={inputCls()} />
      </Field>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/invoices"
          className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:text-slate-900 bg-white"
          title="Back to invoices"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Create Invoice</h1>
          <p className="text-sm text-slate-500">Manual GST invoice. Totals are recalculated by the server on save.</p>
        </div>
      </div>

      {serverError && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {serverError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-2 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Customer</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name" required error={errors['customer.name']}>
                <input
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  className={inputCls(errors['customer.name'])}
                />
              </Field>
              <Field label="GSTIN" error={errors['customer.gstin']}>
                <input
                  value={customer.gstin}
                  maxLength={15}
                  onChange={(e) => setCustomer({ ...customer, gstin: e.target.value.toUpperCase() })}
                  className={`${inputCls(errors['customer.gstin'])} font-mono`}
                  placeholder="Optional (B2B)"
                />
              </Field>
              <Field label="Email" error={errors['customer.email']}>
                <input
                  type="email"
                  value={customer.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                  className={inputCls(errors['customer.email'])}
                />
              </Field>
              <Field label="Phone">
                <input
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  className={inputCls()}
                />
              </Field>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2">Billing address</p>
              {addressFields(billing, setBilling, 'billing')}
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={sameAsBilling} onChange={(e) => setSameAsBilling(e.target.checked)} />
              Shipping address same as billing
            </label>
            {!sameAsBilling && (
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-2">Shipping address</p>
                {addressFields(shipping, setShipping, 'shipping')}
              </div>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Line items</h2>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add item
              </button>
            </div>
            {errors.items && <p className="text-xs text-rose-600">{errors.items}</p>}

            <div className="space-y-3">
              {lines.map((line, idx) => {
                const p = `line.${line.key}`;
                const calc = totals.items[idx];
                return (
                  <div key={line.key} className="border border-slate-200 rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">Item {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        {products.length > 0 && (
                          <select
                            value={line.productId || ''}
                            onChange={(e) => pickProduct(line.key, e.target.value)}
                            className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white max-w-[220px]"
                            aria-label="Fill from product"
                          >
                            <option value="">Fill from product…</option>
                            {products.map((prod) => (
                              <option key={prod._id} value={prod._id}>
                                {prod.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          title="Remove item"
                          disabled={lines.length === 1}
                          onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md disabled:opacity-30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                      <Field label="Product" required error={errors[`${p}.productName`]} className="col-span-2 md:col-span-2">
                        <input
                          value={line.productName}
                          onChange={(e) => updateLine(line.key, { productName: e.target.value, productId: undefined })}
                          className={inputCls(errors[`${p}.productName`])}
                        />
                      </Field>
                      <Field label="HSN/SAC" required error={errors[`${p}.hsnSac`]}>
                        <input
                          value={line.hsnSac}
                          inputMode="numeric"
                          maxLength={8}
                          onChange={(e) => updateLine(line.key, { hsnSac: e.target.value })}
                          className={`${inputCls(errors[`${p}.hsnSac`])} font-mono`}
                        />
                      </Field>
                      <Field label="Qty" required error={errors[`${p}.quantity`]}>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                          className={inputCls(errors[`${p}.quantity`])}
                        />
                      </Field>
                      <Field label="Unit price (₹)" required error={errors[`${p}.unitPrice`]}>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                          className={inputCls(errors[`${p}.unitPrice`])}
                        />
                      </Field>
                      <Field label="Discount %" error={errors[`${p}.discount`]}>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          value={line.discount}
                          onChange={(e) => updateLine(line.key, { discount: e.target.value })}
                          className={inputCls(errors[`${p}.discount`])}
                        />
                      </Field>
                      <Field label="GST %">
                        <select
                          value={line.gstRate}
                          onChange={(e) => updateLine(line.key, { gstRate: Number(e.target.value) })}
                          className={inputCls()}
                        >
                          {GST_RATES.map((r) => (
                            <option key={r} value={r}>
                              {r}%
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="col-span-2 md:col-span-5 flex flex-wrap items-end justify-end gap-x-4 gap-y-1 text-xs text-slate-600">
                        <span>Taxable {formatCurrency(calc.taxableAmount)}</span>
                        <span>GST {formatCurrency(calc.gstAmount)}</span>
                        <span className="font-semibold text-slate-900">Line total {formatCurrency(calc.totalAmount)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Invoice date" required>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className={inputCls()}
                />
              </Field>
              <Field label="Due date" error={errors.dueDate}>
                <input
                  type="date"
                  value={dueDate}
                  min={invoiceDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputCls(errors.dueDate)}
                />
              </Field>
              <Field label="Notes" className="sm:col-span-2">
                <textarea
                  value={notes}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => setNotes(e.target.value)}
                  className={inputCls()}
                />
              </Field>
            </div>
          </section>
        </div>

        <aside className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3 xl:sticky xl:top-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Summary</h2>
          <dl className="space-y-2 text-sm">
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
            <div className="flex justify-between"><dt className="text-slate-500">Round Off</dt><dd>{formatCurrency(totals.roundOff)}</dd></div>
            <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-900">
              <dt>Grand Total</dt>
              <dd>{formatCurrency(totals.grandTotal)}</dd>
            </div>
          </dl>
          <p className="text-xs text-slate-500">
            {placeOfSupply ? `Place of supply: ${placeOfSupply}. ` : 'Select the customer state to set place of supply. '}
            {supplyType === 'INTRA_STATE' ? 'Intra-state: CGST + SGST.' : 'Inter-state: IGST.'}
          </p>
          <button
            type="button"
            onClick={openPreview}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800"
          >
            <Eye className="w-4 h-4" />
            Preview & Save
          </button>
          {Object.keys(errors).length > 0 && (
            <p className="text-xs text-rose-600">Fix the highlighted fields to continue.</p>
          )}
        </aside>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-8">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">Invoice preview</h2>
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <InvoicePreview
                business={business}
                customer={previewCustomer}
                totals={totals}
                supplyType={supplyType}
                placeOfSupply={placeOfSupply}
                invoiceDate={invoiceDate}
                dueDate={dueDate}
                notes={notes.trim()}
              />
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
              <button
                type="button"
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 text-sm font-semibold border border-slate-200 rounded-lg bg-white hover:bg-slate-50"
              >
                Back to edit
              </button>
              <button
                type="button"
                onClick={save}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
