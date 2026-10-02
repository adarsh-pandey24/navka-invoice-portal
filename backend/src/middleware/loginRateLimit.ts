import { Request, Response, NextFunction } from 'express';
import { ENV } from '../config/env';

interface Bucket {
  failures: number;
  resetAt: number;
}

// In-memory failed-login counter keyed by IP + email. Good for a single server
// instance; a multi-instance deployment needs a shared store (e.g. Redis).
const buckets = new Map<string, Bucket>();

const keyFor = (req: Request) => `${req.ip}|${String(req.body?.email || '').toLowerCase().trim()}`;

const prune = (now: number) => {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
};

/**
 * Blocks brute-force password guessing: after LOGIN_MAX_ATTEMPTS failed logins
 * for the same IP + email within LOGIN_WINDOW_MINUTES, further attempts get 429.
 * A successful login clears the counter.
 */
export const loginRateLimit = (req: Request, res: Response, next: NextFunction): void => {
  const now = Date.now();
  prune(now);
  const key = keyFor(req);
  const bucket = buckets.get(key);

  if (bucket && bucket.resetAt > now && bucket.failures >= ENV.LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    });
    return;
  }

  res.on('finish', () => {
    if (res.statusCode === 200) {
      buckets.delete(key);
      return;
    }
    if (res.statusCode !== 401) return;
    const current = buckets.get(key);
    if (!current || current.resetAt <= Date.now()) {
      buckets.set(key, { failures: 1, resetAt: Date.now() + ENV.LOGIN_WINDOW_MINUTES * 60_000 });
    } else {
      current.failures += 1;
    }
  });

  next();
};

// Test helper.
export const resetLoginRateLimit = () => buckets.clear();
