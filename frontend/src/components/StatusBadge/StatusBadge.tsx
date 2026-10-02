import React from 'react';
import { invoiceStatusClass, paymentStatusClass } from '../../utils/format';

interface StatusBadgeProps {
  label: string;
  kind?: 'payment' | 'invoice';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, kind = 'payment' }) => {
  const cls = kind === 'invoice' ? invoiceStatusClass(label) : paymentStatusClass(label);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide border ${cls}`}>
      {label}
    </span>
  );
};
