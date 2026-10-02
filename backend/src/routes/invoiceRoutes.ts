import { Router } from 'express';
import {
  createInvoice,
  createInvoiceSchema,
  downloadInvoicePdf,
  getInvoiceById,
  listInvoices,
  updateInvoice,
  updateInvoiceSchema,
} from '../controllers/invoiceController';
import { authenticateUser } from '../middleware/authMiddleware';
import { authorizeRole } from '../middleware/roleMiddleware';
import { validateBody } from '../middleware/validateMiddleware';

const router = Router();

router.use(authenticateUser);

// CA is view-only: any mutation on invoice routes is Admin-only (403).
router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    authorizeRole('ADMIN')(req, res, next);
    return;
  }
  next();
});

// GET /api/invoices — Admin & CA
router.get('/', listInvoices);

// POST /api/invoices — Admin only (manual GST invoice)
router.post('/', authorizeRole('ADMIN'), validateBody(createInvoiceSchema), createInvoice);

// GET /api/invoices/:id/pdf — Admin & CA (?download=1 for attachment)
router.get('/:id/pdf', downloadInvoicePdf);

// GET /api/invoices/:id — Admin & CA
router.get('/:id', getInvoiceById);

// PUT /api/invoices/:id — Admin only (cancel / notes)
router.put('/:id', authorizeRole('ADMIN'), validateBody(updateInvoiceSchema), updateInvoice);

export default router;
