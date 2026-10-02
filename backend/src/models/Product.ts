import mongoose, { Document, Schema, Model } from 'mongoose';

export interface IProduct extends Document {
  name: string;
  sku?: string;
  hsnSac: string;
  unitPrice: number;
  gstRate: number; // e.g. 5, 12, 18, 28
  shopifyProductId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      index: true,
    },
    sku: {
      type: String,
      trim: true,
      sparse: true,
    },
    hsnSac: {
      type: String,
      required: [true, 'HSN/SAC code is required'],
      trim: true,
      index: true,
    },
    unitPrice: {
      type: Number,
      required: [true, 'Unit price is required'],
      min: [0, 'Unit price cannot be negative'],
    },
    gstRate: {
      type: Number,
      required: [true, 'GST rate is required'],
      enum: [0, 5, 12, 18, 28],
      default: 18,
    },
    shopifyProductId: {
      type: String,
      sparse: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Product: Model<IProduct> = mongoose.model<IProduct>('Product', productSchema);
export default Product;
