import React, { useEffect, useState } from 'react';
import { AlertCircle, Lock } from 'lucide-react';
import apiClient from '../services/api';
import { BusinessSettings } from '../types';
import { useAuth } from '../context/AuthContext';
import { Field, inputClass, primaryButton } from '../components/UI/Modal';

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Form = {
  businessName: string;
  address: string;
  gstin: string;
  contactEmail: string;
  contactPhone: string;
  logoUrl: string;
  invoicePrefix: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branch: string;
};

const toForm = (s: BusinessSettings): Form => ({
  businessName: s.businessName || '',
  address: s.address || '',
  gstin: s.gstin || '',
  contactEmail: s.contactEmail || '',
  contactPhone: s.contactPhone || '',
  logoUrl: s.logoUrl || '',
  invoicePrefix: s.invoicePrefix || '',
  bankName: s.bankDetails?.bankName || '',
  accountNumber: s.bankDetails?.accountNumber || '',
  ifscCode: s.bankDetails?.ifscCode || '',
  branch: s.bankDetails?.branch || '',
});

// Admin edits; CA sees the same form read-only (route matrix: /settings view-only for CA).
export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient
      .get('/settings')
      .then((res) => setForm(toForm(res.data.settings)))
      .catch((err) => setMessage({ kind: 'error', text: err.response?.data?.message || 'Could not load settings.' }));
  }, []);

  if (!form) {
    return message ? (
      <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-xl text-sm">{message.text}</div>
    ) : (
      <div className="py-24 text-center text-sm text-slate-400">Loading settings...</div>
    );
  }

  const set = (key: keyof Form, value: string) => setForm({ ...form, [key]: value });

  const validate = () => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!form.businessName.trim()) e.businessName = 'Required';
    if (!form.address.trim()) e.address = 'Required';
    if (!GSTIN_REGEX.test(form.gstin.trim().toUpperCase())) e.gstin = 'Invalid GSTIN';
    if (!EMAIL_REGEX.test(form.contactEmail.trim())) e.contactEmail = 'Invalid email';
    if (!form.contactPhone.trim()) e.contactPhone = 'Required';
    if (!/^[A-Za-z0-9]{2,10}$/.test(form.invoicePrefix.trim())) e.invoicePrefix = '2-10 letters or digits';
    if (form.accountNumber && !/^\d{6,20}$/.test(form.accountNumber.trim())) e.accountNumber = '6-20 digits';
    if (form.ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifscCode.trim().toUpperCase())) e.ifscCode = 'Invalid IFSC';
    if (form.logoUrl && !/^https?:\/\/\S+$/.test(form.logoUrl.trim())) e.logoUrl = 'Must be an http(s) URL';
    return e;
  };

  const save = async () => {
    const e = validate();
    setErrors(e);
    setMessage(null);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const res = await apiClient.put('/settings', {
        businessName: form.businessName.trim(),
        address: form.address.trim(),
        gstin: form.gstin.trim(),
        contactEmail: form.contactEmail.trim(),
        contactPhone: form.contactPhone.trim(),
        logoUrl: form.logoUrl.trim(),
        invoicePrefix: form.invoicePrefix.trim(),
        bankDetails: {
          bankName: form.bankName.trim(),
          accountNumber: form.accountNumber.trim(),
          ifscCode: form.ifscCode.trim(),
          branch: form.branch.trim(),
        },
      });
      setForm(toForm(res.data.settings));
      setMessage({ kind: 'ok', text: 'Settings saved. New invoices will use these details.' });
    } catch (err: any) {
      setMessage({ kind: 'error', text: err.response?.data?.message || 'Could not save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const input = (key: keyof Form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      value={form[key]}
      disabled={!isAdmin}
      onChange={(e) => set(key, e.target.value)}
      className={inputClass(errors[key])}
      {...props}
    />
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Business Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Company profile printed on invoices. Changes apply to invoices created afterwards.</p>
      </div>

      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl text-sm flex items-center gap-2">
          <Lock className="w-4 h-4" />
          View-only. Only Admin can change business settings.
        </div>
      )}
      {message && (
        <div
          className={`p-3 rounded-xl text-sm flex items-center gap-2 border ${
            message.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          {message.kind === 'error' && <AlertCircle className="w-4 h-4" />}
          {message.text}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Business profile</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Business name" required error={errors.businessName} className="sm:col-span-2">
            {input('businessName', { maxLength: 200 })}
          </Field>
          <Field label="Address" required error={errors.address} className="sm:col-span-2">
            {input('address', { maxLength: 500 })}
          </Field>
          <Field label="GSTIN" required error={errors.gstin}>
            {input('gstin', { maxLength: 15, className: `${inputClass(errors.gstin)} font-mono uppercase` })}
          </Field>
          <Field label="Invoice prefix" required error={errors.invoicePrefix}>
            {input('invoicePrefix', { maxLength: 10, className: `${inputClass(errors.invoicePrefix)} uppercase` })}
          </Field>
          <Field label="Contact email" required error={errors.contactEmail}>
            {input('contactEmail', { type: 'email' })}
          </Field>
          <Field label="Contact phone" required error={errors.contactPhone}>
            {input('contactPhone', { maxLength: 30 })}
          </Field>
          <Field label="Logo URL" error={errors.logoUrl} className="sm:col-span-2">
            {input('logoUrl', { placeholder: 'https://…' })}
          </Field>
        </div>
        <p className="text-xs text-slate-500">
          Invoice numbers use the prefix: {form.invoicePrefix.toUpperCase() || 'PREFIX'}-YYYYMM-0001. The GSTIN state code decides CGST/SGST vs IGST.
        </p>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Bank details (printed on invoices)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Bank name">{input('bankName', { maxLength: 100 })}</Field>
          <Field label="Branch">{input('branch', { maxLength: 100 })}</Field>
          <Field label="Account number" error={errors.accountNumber}>
            {input('accountNumber', { inputMode: 'numeric', maxLength: 20 })}
          </Field>
          <Field label="IFSC code" error={errors.ifscCode}>
            {input('ifscCode', { maxLength: 11, className: `${inputClass(errors.ifscCode)} font-mono uppercase` })}
          </Field>
        </div>
      </section>

      {isAdmin && (
        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className={primaryButton}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      )}
    </div>
  );
};
