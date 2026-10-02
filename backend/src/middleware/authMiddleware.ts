import { Request, Response, NextFunction } from 'express';
import { verifyToken, JwtPayload } from '../utils/jwt';
import User from '../models/User';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'ADMIN' | 'CA';
    name?: string;
  };
}

export const authenticateUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.',
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Malformed authorization token.',
      });
      return;
    }

    try {
      const decoded: JwtPayload = verifyToken(token);
      
      // Optionally verify user still exists in DB
      const user = await User.findById(decoded.userId).select('+role');
      if (!user) {
        res.status(401).json({
          success: false,
          message: 'The user belonging to this token no longer exists.',
        });
        return;
      }

      req.user = {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        name: user.name,
      };

      next();
    } catch (err: any) {
      res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token.',
      });
      return;
    }
  } catch (error: any) {
    next(error);
  }
};
