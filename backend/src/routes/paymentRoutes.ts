import { Router } from 'express';
import {
  createPayment,
  createPaymentSchema,
  exportPayments,
  listPayments,
  updatePayment,
  updatePaymentSchema,
} from '../controllers/paymentController';
import { authenticateUser } from '../middleware/authMiddleware';
import { authorizeRole } from '../middleware/roleMiddleware';
import { validateBody } from '../middleware/validateMiddleware';

const router = Router();

router.use(authenticateUser);

// GET /api/payments — Admin & CA (unified ledger)
router.get('/', listPayments);

// GET /api/payments/export?format=csv|excel — Admin & CA
router.get('/export', exportPayments);

// POST /api/payments — Admin only (record offline payment)
router.post('/', authorizeRole('ADMIN'), validateBody(createPaymentSchema), createPayment);

// PUT /api/payments/:id — Admin only (offline payment reference / notes / status)
router.put('/:id', authorizeRole('ADMIN'), validateBody(updatePaymentSchema), updatePayment);

export default router;
