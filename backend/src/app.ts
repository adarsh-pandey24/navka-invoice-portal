import fs from 'fs';
import path from 'path';
import express, { Application, Request, Response } from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ENV } from './config/env';
import { notFoundHandler, errorHandler } from './middleware/errorMiddleware';
import authRoutes from './routes/authRoutes';
import dashboardRoutes from './routes/dashboardRoutes';
import shopifyRoutes from './routes/shopifyRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import hsnMappingRoutes from './routes/hsnMappingRoutes';
import settingsRoutes from './routes/settingsRoutes';
import paymentRoutes from './routes/paymentRoutes';
import reportRoutes from './routes/reportRoutes';

const app: Application = express();
const isProduction = ENV.NODE_ENV === 'production';

if (ENV.TRUST_PROXY) {
  // e.g. "1" behind one nginx / load balancer, so req.ip is the client (login rate limit).
  app.set('trust proxy', /^\d+$/.test(ENV.TRUST_PROXY) ? Number(ENV.TRUST_PROXY) : ENV.TRUST_PROXY);
}
app.disable('x-powered-by');

// Security & Parsing Middlewares
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    // Dev Vite origins are only allowed outside production.
    origin: isProduction ? ENV.CORS_ORIGIN : [ENV.CORS_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
    // Lets the browser read download filenames on cross-origin deployments.
    exposedHeaders: ['Content-Disposition'],
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

if (ENV.NODE_ENV !== 'test') {
  app.use(morgan(isProduction ? 'combined' : 'dev'));
}

// Health check endpoint (used by load balancers / uptime checks).
app.get('/api/health', (req: Request, res: Response) => {
  const dbConnected = mongoose.connection.readyState === 1;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'healthy' : 'degraded',
    database: dbConnected ? 'connected' : 'disconnected',
    application: 'NAVKA Invoice Management Web App API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Mounted API routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/hsn-mappings', hsnMappingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);

// Production: serve the built React app from the same origin (single deployable).
const frontendIndex = ENV.FRONTEND_DIST ? path.join(ENV.FRONTEND_DIST, 'index.html') : '';
if (isProduction && frontendIndex && fs.existsSync(frontendIndex)) {
  // Hashed asset files can be cached for a long time; index.html must always be revalidated.
  app.use('/assets', express.static(path.join(ENV.FRONTEND_DIST, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(ENV.FRONTEND_DIST, { index: false, maxAge: 0 }));
  app.get(/^\/(?!api\/).*/, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(frontendIndex);
  });
}

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
