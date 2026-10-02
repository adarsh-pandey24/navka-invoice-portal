import { assert } from './assert';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import { Invoice, Payment, Product } from '../models';
import { request, seededTokens } from './http';

// Phase 10: sweep every API route for the Admin vs CA permission matrix.
async function testRbacMatrix() {
  console.log('\n--- Starting Phase 10: RBAC Permission Matrix Sweep ---\n');
  await connectDB();
  await seedAllData();
  const { admin, ca } = await seededTokens();
  const server = app.listen(0);

  try {
    const invoice = await Invoice.findOne({ invoiceNumber: 'NAVKA-2026-0004' });
    const payment = await Payment.findOne({ paymentSource: 'OFFLINE' });
    const product = await Product.findOne();
    const invId = invoice!._id.toString();

    const readRoutes = [
      '/api/auth/me',
      '/api/dashboard',
      '/api/invoices',
      `/api/invoices/${invId}`,
      `/api/invoices/${invId}/pdf`,
      '/api/payments',
      '/api/payments/export?format=csv',
      '/api/reports/sales',
      '/api/reports/sales/export?format=csv',
      '/api/settings',
      '/api/hsn-mappings',
      '/api/shopify/status',
    ];

    // Bodies are invalid on purpose: RBAC must reject CA before validation runs.
    const writeRoutes: Array<{ method: string; path: string }> = [
      { method: 'POST', path: '/api/invoices' },
      { method: 'PUT', path: `/api/invoices/${invId}` },
      { method: 'DELETE', path: `/api/invoices/${invId}` },
      { method: 'POST', path: '/api/payments' },
      { method: 'PUT', path: `/api/payments/${payment!._id}` },
      { method: 'PUT', path: '/api/settings' },
      { method: 'POST', path: '/api/shopify/sync' },
      { method: 'POST', path: '/api/hsn-mappings' },
      { method: 'PUT', path: `/api/hsn-mappings/${product!._id}` },
    ];

    console.log('[Test 1] Unauthenticated requests are rejected with 401...');
    for (const path of readRoutes) {
      const res = await request(server, { method: 'GET', path });
      assert(res.status === 401, `GET ${path} without token: expected 401, got ${res.status}`);
    }
    for (const r of writeRoutes) {
      const res = await request(server, { method: r.method, path: r.path, body: {} });
      assert(res.status === 401, `${r.method} ${r.path} without token: expected 401, got ${res.status}`);
    }
    const forged = await request(server, {
      method: 'GET',
      path: '/api/invoices',
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiQURNSU4ifQ.forged' },
    });
    assert(forged.status === 401, 'forged token 401');
    console.log(`✓ Test 1 Passed: ${readRoutes.length + writeRoutes.length} routes require a valid token`);

    console.log('[Test 2] CA can read every view/export route...');
    for (const path of readRoutes) {
      const res = await request(server, { method: 'GET', path, headers: ca });
      assert(res.status === 200, `CA GET ${path}: expected 200, got ${res.status}`);
    }
    console.log(`✓ Test 2 Passed: CA reads ${readRoutes.length} routes`);

    console.log('[Test 3] CA is blocked from every mutation with 403...');
    for (const r of writeRoutes) {
      const res = await request(server, { method: r.method, path: r.path, headers: ca, body: {} });
      assert(res.status === 403, `CA ${r.method} ${r.path}: expected 403, got ${res.status}`);
    }
    const unchanged = await Invoice.findById(invId);
    assert(unchanged!.invoiceStatus === 'ACTIVE' && unchanged!.notes === invoice!.notes, 'CA attempts changed nothing');
    console.log(`✓ Test 3 Passed: CA gets 403 on ${writeRoutes.length} mutation routes`);

    console.log('[Test 4] Admin passes RBAC on every mutation (reaches validation or handler)...');
    for (const r of writeRoutes) {
      const res = await request(server, { method: r.method, path: r.path, headers: admin, body: {} });
      assert(res.status !== 401 && res.status !== 403, `Admin ${r.method} ${r.path}: got ${res.status}`);
    }
    console.log('✓ Test 4 Passed: Admin is never 401/403 on mutation routes');

    console.log('\n======================================================');
    console.log(' ALL PHASE 10 RBAC MATRIX TESTS PASSED!               ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

testRbacMatrix().catch((err) => {
  console.error('RBAC matrix test failed:', err);
  process.exit(1);
});
