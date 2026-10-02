import { Router } from 'express';
import { syncShopifyOrders, getShopifyStatus } from '../controllers/shopifyController';
import { authenticateUser } from '../middleware/authMiddleware';
import { authorizeRole } from '../middleware/roleMiddleware';

const router = Router();

// GET /api/shopify/status - Status check (Admin & CA)
router.get('/status', authenticateUser, getShopifyStatus);

// POST /api/shopify/sync - Ingest orders (ADMIN ONLY)
router.post('/sync', authenticateUser, authorizeRole('ADMIN'), syncShopifyOrders);

export default router;
