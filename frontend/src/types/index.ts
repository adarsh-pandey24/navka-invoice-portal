export type UserRole = 'ADMIN' | 'CA';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt?: string;
}

export type PaymentStatus = 'PAID' | 'PENDING' | 'PARTIAL' | 'FAILED' | 'REFUNDED';
export type InvoiceStatus = 'ACTIVE' | 'CANCELLED';
export type PaymentMethod = 'ONLINE' | 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';
export type PaymentSource = 'ONLINE' | 'OFFLINE';

export interface InvoiceItem {
  _id?: string;
  productName: string;
  hsnSac: string;
  quantity: number;
  unitPrice: number;
  discount: number; // percentage or fixed
  taxableAmount: number;
  gstRate: number; // e.g. 5, 12, 18, 28
  gstAmount: number;
  totalAmount: number;
}

export interface CustomerAddress {
  street?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

export interface CustomerInfo {
  name: string;
  email?: string;
  phone?: string;
  gstin?: string;
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
}

export interface Invoice {
  _id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  shopifyOrderId?: string;
  shopifyOrderNumber?: string;
  customer: CustomerInfo;
  businessDetails: {
    name: string;
    address: string;
    gstin: string;
    phone: string;
    email: string;
    logoUrl?: string;
  };
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  totalGST: number;
  grandTotal: number;
  roundOff?: number;
  amountInWords?: string;
  paymentStatus: PaymentStatus;
  invoiceStatus: InvoiceStatus;
  source: 'SHOPIFY' | 'MANUAL';
  refundDetails?: {
    isRefunded: boolean;
    refundAmount: number;
    refundDate?: string;
    refundReason?: string;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessSettings {
  businessName: string;
  address: string;
  gstin: string;
  contactEmail: string;
  contactPhone: string;
  logoUrl?: string;
  invoicePrefix: string;
  bankDetails?: {
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
    branch?: string;
  };
}

export interface Payment {
  _id: string;
  invoiceId: string | { _id: string; invoiceNumber: string; customer: CustomerInfo };
  orderId?: string;
  amount: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  paymentSource: PaymentSource;
  paymentStatus: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  referenceId?: string;
  notes?: string;
  recordedBy?: string | { _id: string; name: string } | null;
  createdAt: string;
}

// Payment as returned by GET /api/payments (invoice and recorder populated).
export interface LedgerPayment extends Omit<Payment, 'invoiceId' | 'recordedBy'> {
  invoiceId: {
    _id: string;
    invoiceNumber: string;
    customer?: { name?: string };
    grandTotal: number;
    paymentStatus: PaymentStatus;
    invoiceStatus: InvoiceStatus;
    source: 'SHOPIFY' | 'MANUAL';
  } | null;
  recordedBy?: { _id: string; name: string } | null;
}

export interface PaginationMeta {
  currentPage: number;
  limit: number;
  totalRecords: number;
  totalPages: number;
}
