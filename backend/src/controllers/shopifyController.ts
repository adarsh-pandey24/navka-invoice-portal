import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { ShopifyService } from '../services/shopifyService';
import { ENV } from '../config/env';

export const syncShopifyOrders = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const sinceId = typeof req.query.since_id === 'string' ? req.query.since_id : undefined;
    const createdAtMin = typeof req.query.created_at_min === 'string' ? req.query.created_at_min : undefined;

    const result = await ShopifyService.syncAll({ sinceId, createdAtMin });
    const failedNote = result.failed.length ? ` ${result.failed.length} order(s) failed.` : '';
    res.status(200).json({
      success: true,
      message: `Successfully synchronized ${result.count} order(s) from Shopify.${failedNote}`,
      syncedCount: result.count,
      failedCount: result.failed.length,
      failed: result.failed,
    });
  } catch (error: any) {
    next(error);
  }
};

export const getShopifyStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    res.status(200).json({
      success: true,
      storeDomain: ENV.SHOPIFY_STORE_DOMAIN,
      apiVersion: ENV.SHOPIFY_API_VERSION,
      isConfigured: !!ENV.SHOPIFY_STORE_DOMAIN && !!ENV.SHOPIFY_ACCESS_TOKEN,
      mode: ShopifyService.isDemoMode() ? 'DEMO_MOCK_INTEGRATION' : 'LIVE_SHOPIFY_API',
    });
  } catch (error: any) {
    next(error);
  }
};
