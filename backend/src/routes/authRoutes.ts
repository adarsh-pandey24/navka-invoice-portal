import { Router } from 'express';
import { login, getMe } from '../controllers/authController';
import { authenticateUser } from '../middleware/authMiddleware';
import { authorizeRole } from '../middleware/roleMiddleware';
import { loginRateLimit } from '../middleware/loginRateLimit';

const router = Router();

// Public login route
router.post('/login', loginRateLimit, login);

// Authenticated session check
router.get('/me', authenticateUser, getMe);

// RBAC Verification routes
router.get('/admin-only', authenticateUser, authorizeRole('ADMIN'), (req, res) => {
  res.json({ success: true, message: 'Welcome Admin! You have write and administrative access.' });
});

router.get('/ca-view', authenticateUser, authorizeRole('ADMIN', 'CA'), (req, res) => {
  res.json({ success: true, message: 'Welcome CA / Auditor! You have view access.' });
});

export default router;
