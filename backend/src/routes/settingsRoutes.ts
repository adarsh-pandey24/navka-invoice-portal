import { Router } from 'express';
import { getSettings, updateSettings, updateSettingsSchema } from '../controllers/settingsController';
import { authenticateUser } from '../middleware/authMiddleware';
import { authorizeRole } from '../middleware/roleMiddleware';
import { validateBody } from '../middleware/validateMiddleware';

const router = Router();

router.use(authenticateUser);

// GET /api/settings — Admin & CA (CA view-only)
router.get('/', getSettings);

// PUT /api/settings — Admin only
router.put('/', authorizeRole('ADMIN'), validateBody(updateSettingsSchema), updateSettings);

export default router;
