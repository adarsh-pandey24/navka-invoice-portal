import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IBankDetails {
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  branch?: string;
}

export interface IBusinessSettings extends Document {
  businessName: string;
  address: string;
  gstin: string;
  contactEmail: string;
  contactPhone: string;
  logoUrl?: string;
  invoicePrefix: string;
  bankDetails: IBankDetails;
  createdAt: Date;
  updatedAt: Date;
}

const businessSettingsSchema = new Schema<IBusinessSettings>(
  {
    businessName: {
      type: String,
      required: true,
      default: 'NAVKA Enterprises Private Limited',
      trim: true,
    },
    address: {
      type: String,
      required: true,
      default: 'Plot 42, Industrial Area Phase II, Okhla, New Delhi, Delhi 110020',
      trim: true,
    },
    gstin: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: '07AAAAA0000A1Z5',
    },
    contactEmail: {
      type: String,
      required: true,
      default: 'billing@navka.com',
      trim: true,
    },
    contactPhone: {
      type: String,
      required: true,
      default: '+91 98765 43210',
      trim: true,
    },
    logoUrl: {
      type: String,
      trim: true,
    },
    invoicePrefix: {
      type: String,
      default: 'NAVKA',
      trim: true,
    },
    bankDetails: {
      bankName: { type: String, default: 'HDFC Bank' },
      accountNumber: { type: String, default: '50200012345678' },
      ifscCode: { type: String, default: 'HDFC0000123' },
      branch: { type: String, default: 'New Delhi Main' },
    },
  },
  {
    timestamps: true,
  }
);

export const BusinessSettings: Model<IBusinessSettings> = mongoose.model<IBusinessSettings>(
  'BusinessSettings',
  businessSettingsSchema
);
export default BusinessSettings;
