import { z } from 'zod';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import BusinessSettings from '../models/BusinessSettings';

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// GET /api/settings — read-only business profile (schema defaults if none saved yet).
export const getSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const settings = (await BusinessSettings.findOne().lean()) || new BusinessSettings().toObject();
    res.status(200).json({ success: true, settings });
  } catch (error) {
    next(error);
  }
};

export const updateSettingsSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required').max(200),
  address: z.string().trim().min(1, 'Address is required').max(500),
  gstin: z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Invalid GSTIN format'),
  contactEmail: z.string().trim().email('Invalid contact email'),
  contactPhone: z.string().trim().min(1, 'Contact phone is required').max(30),
  logoUrl: z.string().trim().url('Logo URL must be a valid URL').max(500).optional().or(z.literal('')),
  // Used in invoice numbers (PREFIX-YYYYMM-XXXX); letters and digits only.
  invoicePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, 'Invoice prefix must be 2-10 letters or digits'),
  bankDetails: z
    .object({
      bankName: z.string().trim().max(100).optional(),
      accountNumber: z.string().trim().regex(/^\d{6,20}$/, 'Account number must be 6-20 digits').optional().or(z.literal('')),
      ifscCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code')
        .optional()
        .or(z.literal('')),
      branch: z.string().trim().max(100).optional(),
    })
    .optional(),
});

// PUT /api/settings — Admin only. New values apply to invoices created afterwards;
// existing invoices keep the business details they were issued with.
export const updateSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const body = req.body as z.infer<typeof updateSettingsSchema>;
    const settings = await BusinessSettings.findOneAndUpdate(
      {},
      { $set: { ...body, logoUrl: body.logoUrl || undefined } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    res.status(200).json({ success: true, settings });
  } catch (error) {
    next(error);
  }
};
