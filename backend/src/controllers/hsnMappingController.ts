import mongoose from 'mongoose';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Product from '../models/Product';
import { AppError } from '../middleware/errorMiddleware';

export const listHsnMappings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const mappings = await Product.find()
      .select('name sku hsnSac gstRate shopifyProductId unitPrice updatedAt')
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      mappings,
    });
  } catch (error) {
    next(error);
  }
};

export const upsertHsnMapping = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, sku, hsnSac, shopifyProductId, gstRate, unitPrice } = req.body || {};

    if (!hsnSac || typeof hsnSac !== 'string') {
      throw new AppError('HSN/SAC is required.', 400);
    }

    const normalizedHsn = String(hsnSac).trim().toUpperCase() === 'UNMAPPED'
      ? 'UNMAPPED'
      : String(hsnSac).trim();

    if (req.params.id) {
      if (!mongoose.isValidObjectId(req.params.id)) {
        throw new AppError('Invalid mapping ID.', 400);
      }
      const updated = await Product.findByIdAndUpdate(
        req.params.id,
        {
          hsnSac: normalizedHsn,
          ...(name !== undefined && { name }),
          ...(sku !== undefined && { sku }),
          ...(shopifyProductId !== undefined && { shopifyProductId }),
          ...(gstRate !== undefined && { gstRate }),
          ...(unitPrice !== undefined && { unitPrice }),
        },
        { new: true, runValidators: true }
      );
      if (!updated) {
        throw new AppError('HSN/SAC mapping not found.', 404);
      }
      res.status(200).json({ success: true, mapping: updated });
      return;
    }

    if (!name) {
      throw new AppError('Product name is required to create an HSN/SAC mapping.', 400);
    }

    const created = await Product.create({
      name,
      sku,
      hsnSac: normalizedHsn,
      shopifyProductId,
      gstRate: gstRate ?? 18,
      unitPrice: unitPrice ?? 0,
    });

    res.status(201).json({ success: true, mapping: created });
  } catch (error) {
    next(error);
  }
};
