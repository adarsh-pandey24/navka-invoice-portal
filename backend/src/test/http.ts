import http from 'http';
import { User } from '../models';
import { generateToken } from '../utils/jwt';

export interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  raw: Buffer;
  body: any;
}

// Minimal HTTP client for API tests; parses JSON bodies and keeps raw bytes for files.
export const request = (
  server: http.Server,
  options: { method: string; path: string; headers?: Record<string, string>; body?: unknown }
): Promise<TestResponse> =>
  new Promise((resolve, reject) => {
    const port = (server.address() as any).port;
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        // Fresh connection per request: a rejected request must not poison a reused socket.
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          ...(payload !== undefined && { 'Content-Length': Buffer.byteLength(payload) }),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const isJson = (res.headers['content-type'] || '').includes('application/json');
          resolve({ status: res.statusCode || 500, headers: res.headers, raw, body: isJson ? JSON.parse(raw.toString('utf8')) : undefined });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Tokens for the seeded Admin and CA users. */
export const seededTokens = async () => {
  const admin = await User.findOne({ role: 'ADMIN' });
  const ca = await User.findOne({ role: 'CA' });
  if (!admin || !ca) throw new Error('Seed users missing');
  const token = (u: typeof admin) => generateToken({ userId: u._id.toString(), role: u.role, email: u.email });
  return { admin: bearer(token(admin)), ca: bearer(token(ca)), adminUser: admin, caUser: ca };
};

export const near = (a: number, b: number, tolerance = 0.011) => Math.abs(a - b) < tolerance;

/** A valid manual-invoice payload; override fields per test. */
export const manualInvoicePayload = (overrides: Record<string, unknown> = {}) => ({
  customer: {
    name: 'Test Traders',
    email: 'test@traders.example',
    billingAddress: { street: '1 Test Street', city: 'Pune', state: 'Maharashtra', pincode: '411001', country: 'India' },
  },
  items: [{ productName: 'Widget', hsnSac: '847160', quantity: 2, unitPrice: 1000, discount: 0, gstRate: 18 }],
  ...overrides,
});
