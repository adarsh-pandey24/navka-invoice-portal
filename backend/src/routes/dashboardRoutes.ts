import { Router } from 'express';
import { getDashboardMetrics } from '../controllers/dashboardController';
import { authenticateUser } from '../middleware/authMiddleware';

const router = Router();

// GET /api/dashboard - Access granted to all authenticated roles (ADMIN & CA)
router.get('/', authenticateUser, getDashboardMetrics);

export default router;
