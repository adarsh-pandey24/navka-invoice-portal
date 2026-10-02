import mongoose, { Document, Schema, Model, Types } from 'mongoose';
import { IAddress } from './Customer';

export type PaymentStatus = 'PAID' | 'PENDING' | 'PARTIAL' | 'FAILED' | 'REFUNDED';
export type InvoiceStatus = 'ACTIVE' | 'CANCELLED';
export type InvoiceSource = 'SHOPIFY' | 'MANUAL';

export interface IInvoiceItem {
  productId?: Types.ObjectId;
  productName: string;
  hsnSac: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxableAmount: number;
  gstRate: number;
  gstAmount: number;
  totalAmount: number;
}

export interface IInvoiceCustomer {
  customerId?: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  gstin?: string;
  billingAddress?: IAddress;
  shippingAddress?: IAddress;
}

export interface IInvoiceBusiness {
  name: string;
  address: string;
  gstin: string;
  phone: string;
  email: string;
  logoUrl?: string;
}

export interface IInvoiceRefund {
  isRefunded: boolean;
  refundAmount: number;
  refundDate?: Date;
  refundReason?: string;
}

export interface IInvoice extends Document {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date;
  shopifyOrderId?: string;
  shopifyOrderNumber?: string;
  customer: IInvoiceCustomer;
  businessDetails: IInvoiceBusiness;
  items: IInvoiceItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  totalGST: number;
  grandTotal: number;
  roundOff: number;
  amountInWords: string;
  paymentStatus: PaymentStatus;
  invoiceStatus: InvoiceStatus;
  source: InvoiceSource;
  refundDetails?: IInvoiceRefund;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceItemSchema = new Schema<IInvoiceItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    productName: { type: String, required: true, trim: true },
    hsnSac: { type: String, required: true, trim: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxableAmount: { type: Number, required: true },
    gstRate: { type: Number, required: true, min: 0 },
    gstAmount: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
  },
  { _id: true }
);

const invoiceCustomerSchema = new Schema<IInvoiceCustomer>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    billingAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' },
    },
    shippingAddress: {
      street: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: 'India' },
    },
  },
  { _id: false }
);

const invoiceBusinessSchema = new Schema<IInvoiceBusiness>(
  {
    name: { type: String, required: true },
    address: { type: String, required: true },
    gstin: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true },
    logoUrl: { type: String },
  },
  { _id: false }
);

const invoiceSchema = new Schema<IInvoice>(
  {
    invoiceNumber: {
      type: String,
      required: [true, 'Invoice number is required'],
      unique: true,
      trim: true,
      index: true,
    },
    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    dueDate: {
      type: Date,
    },
    shopifyOrderId: {
      type: String,
      sparse: true,
      index: true,
    },
    shopifyOrderNumber: {
      type: String,
      sparse: true,
      trim: true,
    },
    customer: {
      type: invoiceCustomerSchema,
      required: true,
    },
    businessDetails: {
      type: invoiceBusinessSchema,
      required: true,
    },
    items: {
      type: [invoiceItemSchema],
      required: true,
      validate: [(val: IInvoiceItem[]) => val.length > 0, 'Invoice must have at least one item'],
    },
    subtotal: {
      type: Number,
      required: true,
    },
    discount: {
      type: Number,
      default: 0,
    },
    taxableAmount: {
      type: Number,
      required: true,
      index: true,
    },
    totalGST: {
      type: Number,
      required: true,
      index: true,
    },
    grandTotal: {
      type: Number,
      required: true,
      index: true,
    },
    roundOff: {
      type: Number,
      default: 0,
    },
    amountInWords: {
      type: String,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: ['PAID', 'PENDING', 'PARTIAL', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
      index: true,
    },
    invoiceStatus: {
      type: String,
      enum: ['ACTIVE', 'CANCELLED'],
      default: 'ACTIVE',
      index: true,
    },
    source: {
      type: String,
      enum: ['SHOPIFY', 'MANUAL'],
      default: 'MANUAL',
      index: true,
    },
    refundDetails: {
      isRefunded: { type: Boolean, default: false },
      refundAmount: { type: Number, default: 0 },
      refundDate: { type: Date },
      refundReason: { type: String },
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for date and status queries
invoiceSchema.index({ invoiceDate: -1, paymentStatus: 1 });
// Dashboard and sales report always filter on invoiceStatus + invoiceDate range.
invoiceSchema.index({ invoiceStatus: 1, invoiceDate: -1 });
invoiceSchema.index({ 'customer.name': 'text', invoiceNumber: 'text', shopifyOrderNumber: 'text' });

export const Invoice: Model<IInvoice> = mongoose.model<IInvoice>('Invoice', invoiceSchema);
export default Invoice;
