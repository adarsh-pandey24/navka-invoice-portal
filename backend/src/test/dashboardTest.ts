import { assert } from './assert';
import http from 'http';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import User from '../models/User';
import { generateToken } from '../utils/jwt';

const request = (
  server: http.Server,
  options: { method: string; path: string; headers?: Record<string, string>; body?: any }
): Promise<{ status: number; body: any }> => {
  return new Promise((resolve, reject) => {
    const port = (server.address() as any).port;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            const parsed = rawData ? JSON.parse(rawData) : {};
            resolve({ status: res.statusCode || 500, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode || 500, body: rawData });
          }
        });
      }
    );

    req.on('error', reject);
    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
};

async function testDashboard() {
  console.log('\n--- Starting Phase 4: Dashboard Aggregation & API Verification Tests ---\n');
  await connectDB();
  await seedAllData();

  const caUser = await User.findOne({ role: 'CA' });
  if (!caUser) throw new Error('CA user missing');

  const caToken = generateToken({
    userId: caUser._id.toString(),
    role: caUser.role,
    email: caUser.email,
  });

  const server = app.listen(0);

  try {
    // Test 1: CA accessing dashboard (all time)
    console.log('[Test 1] Testing GET /api/dashboard?period=all with CA token...');
    const allRes = await request(server, {
      method: 'GET',
      path: '/api/dashboard?period=all',
      headers: { Authorization: `Bearer ${caToken}` },
    });

    assert(allRes.status === 200, `Expected 200, got ${allRes.status}`);
    const summary = allRes.body.summary;
    assert(summary.totalSales > 0, 'Total sales should be > 0');
    assert(summary.totalInvoices === 5, `Expected 5 invoices, got ${summary.totalInvoices}`);
    assert(summary.totalGST > 0, 'Total GST should be > 0');
    assert(summary.pendingPayments > 0, 'Pending payments should be > 0');
    assert(summary.refunds > 0, 'Refunds should be > 0');

    console.log(
      `✓ Test 1 Passed: Dashboard summary verified - Total Sales: ₹${summary.totalSales.toLocaleString('en-IN')}, Invoices: ${summary.totalInvoices}, Total GST: ₹${summary.totalGST.toLocaleString('en-IN')}, Pending: ₹${summary.pendingPayments.toLocaleString('en-IN')}, Refunds: ₹${summary.refunds.toLocaleString('en-IN')}`
    );

    // Test 2: Verify Payment Overview counts and amounts
    console.log('[Test 2] Verifying Payment Settlement Overview...');
    const paymentOverview = allRes.body.paymentOverview;
    assert(paymentOverview.paid.count >= 2, 'Expected >= 2 paid invoices');
    assert(paymentOverview.pending.count >= 1, 'Expected >= 1 pending invoice');
    assert(paymentOverview.refunded.count >= 1, 'Expected >= 1 refunded invoice');
    console.log(
      `✓ Test 2 Passed: Payment Overview verified - Paid: ${paymentOverview.paid.count} (₹${paymentOverview.paid.amount}), Pending: ${paymentOverview.pending.count} (₹${paymentOverview.pending.amount}), Refunded: ${paymentOverview.refunded.count} (₹${paymentOverview.refunded.amount})`
    );

    // Test 3: Verify Sales Trend Array
    console.log('[Test 3] Verifying Sales Trend for charts...');
    const trend = allRes.body.salesTrend;
    assert(Array.isArray(trend) && trend.length > 0, 'Sales trend should be a non-empty array');
    assert(trend[0].date && trend[0].sales > 0, 'Trend point must have date and sales');
    console.log(`✓ Test 3 Passed: Sales trend contains ${trend.length} time-series data points`);

    // Test 4: Testing Period Filter: thisMonth
    console.log('[Test 4] Testing GET /api/dashboard?period=thisMonth...');
    const monthRes = await request(server, {
      method: 'GET',
      path: '/api/dashboard?period=thisMonth',
      headers: { Authorization: `Bearer ${caToken}` },
    });
    assert(monthRes.status === 200, `Expected 200, got ${monthRes.status}`);
    console.log(`✓ Test 4 Passed: 'thisMonth' filter executed successfully`);

    // Test 5: Testing Custom Date Range Filter
    console.log('[Test 5] Testing custom date range filter...');
    const now = new Date();
    const past7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    const customRes = await request(server, {
      method: 'GET',
      path: `/api/dashboard?period=custom&startDate=${past7Days}&endDate=${today}`,
      headers: { Authorization: `Bearer ${caToken}` },
    });
    assert(customRes.status === 200, `Expected 200, got ${customRes.status}`);
    console.log(`✓ Test 5 Passed: Custom range (${past7Days} to ${today}) returned successfully`);

    console.log('\n======================================================');
    console.log(' ALL PHASE 4 DASHBOARD VERIFICATION TESTS PASSED!    ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

testDashboard().catch((err) => {
  console.error('Dashboard test failed:', err);
  process.exit(1);
});
