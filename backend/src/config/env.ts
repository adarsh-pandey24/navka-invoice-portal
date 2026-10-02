import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const isProduction = (process.env.NODE_ENV || 'development') === 'production';

// In production, missing or weak secrets must stop the app instead of silently
// falling back to publicly known defaults.
if (isProduction) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters when NODE_ENV=production');
  }
  // Without this the app would fall back to an in-memory database and lose all data on restart.
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI must be set when NODE_ENV=production');
  }
  if (!process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set when NODE_ENV=production');
  }
}

export const ENV = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/navka_invoice_db',
  JWT_SECRET: process.env.JWT_SECRET || 'navka_super_secure_jwt_secret_key_2026_production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN || 'navka-store.myshopify.com',
  SHOPIFY_ACCESS_TOKEN: process.env.SHOPIFY_ACCESS_TOKEN || 'shpat_demo_mock_token_for_testing',
  SHOPIFY_API_VERSION: process.env.SHOPIFY_API_VERSION || '2024-01',
  // Optional: override https://<store domain> (used by tests / proxies only)
  SHOPIFY_BASE_URL: process.env.SHOPIFY_BASE_URL || '',
  // HSN/SAC used when a Shopify line item cannot be matched to a local Product.
  // Deliberately NOT a real code by default so unmapped items are visible, not silently wrong.
  SHOPIFY_DEFAULT_HSN: process.env.SHOPIFY_DEFAULT_HSN || 'UNMAPPED',
  // Retry tuning for Shopify rate limits / transient failures
  SHOPIFY_RETRY_BASE_MS: parseInt(process.env.SHOPIFY_RETRY_BASE_MS || '1000', 10),
  SHOPIFY_MAX_RETRIES: parseInt(process.env.SHOPIFY_MAX_RETRIES || '4', 10),
  // Time zone used to bucket report trends by calendar day.
  REPORT_TIMEZONE: process.env.REPORT_TIMEZONE || 'Asia/Kolkata',
  // Built frontend served by Express in production (empty string disables).
  FRONTEND_DIST: process.env.FRONTEND_DIST ?? path.resolve(__dirname, '../../../frontend/dist'),
  // Set when running behind a reverse proxy (nginx, load balancer) so client IPs are correct.
  TRUST_PROXY: process.env.TRUST_PROXY || '',
  // Failed-login throttling: attempts allowed per IP + email within the window.
  LOGIN_MAX_ATTEMPTS: parseInt(process.env.LOGIN_MAX_ATTEMPTS || '10', 10),
  LOGIN_WINDOW_MINUTES: parseInt(process.env.LOGIN_WINDOW_MINUTES || '15', 10),
};
