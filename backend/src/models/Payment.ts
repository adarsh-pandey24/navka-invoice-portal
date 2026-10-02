import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export type PaymentMethod = 'ONLINE' | 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';
export type PaymentSource = 'ONLINE' | 'OFFLINE';
export type PaymentRecordStatus = 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED';

export interface IPayment extends Document {
  invoiceId: Types.ObjectId;
  orderId?: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: PaymentMethod;
  paymentSource: PaymentSource;
  paymentStatus: PaymentRecordStatus;
  referenceId?: string;
  notes?: string;
  recordedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: 'Invoice',
      required: [true, 'Invoice reference is required'],
      index: true,
    },
    orderId: {
      type: String,
      trim: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: [0.01, 'Amount must be greater than zero'],
    },
    paymentDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    paymentMethod: {
      type: String,
      enum: {
        values: ['ONLINE', 'CASH', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'],
        message: 'Invalid payment method',
      },
      required: true,
      index: true,
    },
    paymentSource: {
      type: String,
      enum: {
        values: ['ONLINE', 'OFFLINE'],
        message: 'Payment source must be ONLINE or OFFLINE',
      },
      required: true,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: {
        values: ['COMPLETED', 'PENDING', 'FAILED', 'REFUNDED'],
        message: 'Invalid payment status',
      },
      default: 'COMPLETED',
      index: true,
    },
    referenceId: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

paymentSchema.index({ paymentDate: -1, paymentSource: 1 });
// Balance lookups sum COMPLETED payments per invoice.
paymentSchema.index({ invoiceId: 1, paymentStatus: 1 });

export const Payment: Model<IPayment> = mongoose.model<IPayment>('Payment', paymentSchema);
export default Payment;
