import { Router } from 'express';
import { listHsnMappings, upsertHsnMapping } from '../controllers/hsnMappingController';
import { authenticateUser } from '../middleware/authMiddleware';
import { authorizeRole } from '../middleware/roleMiddleware';

const router = Router();

router.use(authenticateUser);

// CA: view only. Admin: create/update.
router.get('/', listHsnMappings);
router.post('/', authorizeRole('ADMIN'), upsertHsnMapping);
router.put('/:id', authorizeRole('ADMIN'), upsertHsnMapping);

export default router;
