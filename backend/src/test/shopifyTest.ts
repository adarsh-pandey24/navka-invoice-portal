import { assert } from './assert';
import http from 'http';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import { User, Invoice, Payment, Customer } from '../models';
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

async function testShopifyIntegration() {
  console.log('\n--- Starting Phase 5: Shopify Ingestion & Normalization Verification Tests ---\n');
  await connectDB();
  await seedAllData();

  const admin = await User.findOne({ role: 'ADMIN' });
  const ca = await User.findOne({ role: 'CA' });
  if (!admin || !ca) throw new Error('Admin/CA missing');

  const adminToken = generateToken({
    userId: admin._id.toString(),
    role: admin.role,
    email: admin.email,
  });

  const caToken = generateToken({
    userId: ca._id.toString(),
    role: ca.role,
    email: ca.email,
  });

  const server = app.listen(0);

  try {
    // Test 1: Status endpoint accessible to CA & Admin
    console.log('[Test 1] Testing GET /api/shopify/status...');
    const statusRes = await request(server, {
      method: 'GET',
      path: '/api/shopify/status',
      headers: { Authorization: `Bearer ${caToken}` },
    });
    assert(statusRes.status === 200, `Expected 200, got ${statusRes.status}`);
    assert(!!statusRes.body.storeDomain, 'Store domain expected');
    console.log(`✓ Test 1 Passed: Shopify status endpoint verified (${statusRes.body.storeDomain}, mode: ${statusRes.body.mode})`);

    // Test 2: RBAC - CA calling POST /api/shopify/sync must be rejected with 403
    console.log('[Test 2] Testing CA calling POST /api/shopify/sync (Expect 403 Forbidden)...');
    const caSyncRes = await request(server, {
      method: 'POST',
      path: '/api/shopify/sync',
      headers: { Authorization: `Bearer ${caToken}` },
    });
    assert(caSyncRes.status === 403, `Expected 403, got ${caSyncRes.status}`);
    console.log(`✓ Test 2 Passed: CA strictly forbidden from triggering sync (${caSyncRes.body.message})`);

    // Test 3: Admin triggers Shopify order sync
    console.log('[Test 3] Testing Admin triggering POST /api/shopify/sync...');
    const initialInvoiceCount = await Invoice.countDocuments();
    const syncRes = await request(server, {
      method: 'POST',
      path: '/api/shopify/sync',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(syncRes.status === 200, `Expected 200, got ${syncRes.status}`);
    assert(syncRes.body.syncedCount === 3, `Expected 3 orders synced, got ${syncRes.body.syncedCount}`);
    console.log(`✓ Test 3 Passed: Successfully synced ${syncRes.body.syncedCount} orders from Shopify`);

    // Test 4: Verify Order #1050 (Paid Online)
    console.log('[Test 4] Verifying Order #1050 (Paid Online)...');
    const paidInv = await Invoice.findOne({ shopifyOrderId: '900101' });
    assert(!!paidInv, 'Invoice for 900101 must exist');
    assert(paidInv?.paymentStatus === 'PAID', `Expected PAID, got ${paidInv?.paymentStatus}`);
    assert(paidInv?.source === 'SHOPIFY', 'Source must be SHOPIFY');
    assert(paidInv?.items.length === 1, 'Expected 1 line item');
    assert(paidInv?.items[0].hsnSac === '844332', 'HSN must match product sku');
    
    const paidPay = await Payment.findOne({ invoiceId: paidInv?._id });
    assert(!!paidPay, 'Payment record must exist for paid online order');
    assert(paidPay?.paymentSource === 'ONLINE', 'Payment source must be ONLINE');
    assert(paidPay?.paymentStatus === 'COMPLETED', 'Payment status must be COMPLETED');
    console.log(`✓ Test 4 Passed: Paid online order mapped to Invoice ${paidInv?.invoiceNumber} with associated Payment record`);

    // Test 5: Verify Order #1051 (Refunded)
    console.log('[Test 5] Verifying Order #1051 (Refunded)...');
    const refundInv = await Invoice.findOne({ shopifyOrderId: '900102' });
    assert(!!refundInv, 'Invoice for 900102 must exist');
    assert(refundInv?.paymentStatus === 'REFUNDED', `Expected REFUNDED, got ${refundInv?.paymentStatus}`);
    assert(refundInv?.refundDetails?.isRefunded === true, 'refundDetails.isRefunded must be true');
    assert(refundInv?.refundDetails?.refundAmount === 3304, 'Refund amount must be 3304');
    console.log(`✓ Test 5 Passed: Refunded order mapped with refund amount ₹${refundInv?.refundDetails?.refundAmount}`);

    // Test 6: Verify Order #1052 (Pending)
    console.log('[Test 6] Verifying Order #1052 (Pending)...');
    const pendInv = await Invoice.findOne({ shopifyOrderId: '900103' });
    assert(!!pendInv, 'Invoice for 900103 must exist');
    assert(pendInv?.paymentStatus === 'PENDING', `Expected PENDING, got ${pendInv?.paymentStatus}`);
    console.log(`✓ Test 6 Passed: Pending order mapped to Invoice ${pendInv?.invoiceNumber}`);

    // Test 7: Verify Idempotency on repeated sync
    console.log('[Test 7] Verifying sync idempotency (repeat sync does not duplicate records)...');
    const postSyncCount = await Invoice.countDocuments();
    const secondSync = await request(server, {
      method: 'POST',
      path: '/api/shopify/sync',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(secondSync.status === 200, `Expected 200, got ${secondSync.status}`);
    const finalCount = await Invoice.countDocuments();
    assert(finalCount === postSyncCount, `Count changed on repeat sync! Before: ${postSyncCount}, After: ${finalCount}`);
    console.log(`✓ Test 7 Passed: Repeat sync is 100% idempotent (no duplicate records created)`);

    console.log('\n======================================================');
    console.log(' ALL PHASE 5 SHOPIFY INTEGRATION TESTS PASSED!       ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

testShopifyIntegration().catch((err) => {
  console.error('Shopify test failed:', err);
  process.exit(1);
});
