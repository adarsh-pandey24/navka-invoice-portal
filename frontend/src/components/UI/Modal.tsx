import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl';
}

const SIZES = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export const Modal: React.FC<ModalProps> = ({ title, onClose, children, footer, size = 'md' }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center p-4 overflow-y-auto print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`bg-white rounded-xl shadow-xl w-full ${SIZES[size]} my-8`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">{footer}</div>
        )}
      </div>
    </div>
  );
};

export const inputClass = (error?: string) =>
  `mt-1 w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-1 focus:ring-slate-800 bg-white disabled:bg-slate-50 disabled:text-slate-500 ${
    error ? 'border-rose-400' : 'border-slate-200'
  }`;

export const Field: React.FC<{
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ label, error, required, children, className }) => (
  <label className={`block ${className || ''}`}>
    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
      {label}
      {required && <span className="text-rose-500"> *</span>}
    </span>
    {children}
    {error && <span className="block text-xs text-rose-600 mt-1">{error}</span>}
  </label>
);

export const primaryButton =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50';
export const secondaryButton =
  'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50';
