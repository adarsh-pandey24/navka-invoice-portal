import { Router } from 'express';
import { exportSalesReport, getSalesReport } from '../controllers/reportController';
import { authenticateUser } from '../middleware/authMiddleware';

const router = Router();

router.use(authenticateUser);

// GET /api/reports/sales — Admin & CA
router.get('/sales', getSalesReport);

// GET /api/reports/sales/export?format=csv|excel|pdf — Admin & CA
router.get('/sales/export', exportSalesReport);

export default router;
