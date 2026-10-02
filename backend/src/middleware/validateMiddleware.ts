import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

// Validates req.body against a Zod schema and replaces it with the parsed value.
export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      res.status(400).json({
        success: false,
        message: `Validation failed: ${errors[0].path ? `${errors[0].path}: ` : ''}${errors[0].message}`,
        errors,
      });
      return;
    }
    req.body = result.data;
    next();
  };
};
