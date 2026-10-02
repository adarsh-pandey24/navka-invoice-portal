import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IAddress {
  street?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

export interface ICustomer extends Document {
  name: string;
  email?: string;
  phone?: string;
  gstin?: string;
  billingAddress?: IAddress;
  shippingAddress?: IAddress;
  shopifyCustomerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<IAddress>(
  {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' },
  },
  { _id: false }
);

const customerSchema = new Schema<ICustomer>(
  {
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    gstin: {
      type: String,
      uppercase: true,
      trim: true,
    },
    billingAddress: addressSchema,
    shippingAddress: addressSchema,
    shopifyCustomerId: {
      type: String,
      sparse: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Customer: Model<ICustomer> = mongoose.model<ICustomer>('Customer', customerSchema);
export default Customer;
