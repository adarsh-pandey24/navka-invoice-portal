import { assert } from './assert';
import http from 'http';
import mongoose from 'mongoose';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import { User, Invoice } from '../models';
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
          } catch {
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

async function testInvoices() {
  console.log('\n--- Starting Phase 6: Centralized Invoice Management Verification Tests ---\n');
  await connectDB();
  await seedAllData();

  const admin = await User.findOne({ role: 'ADMIN' });
  const ca = await User.findOne({ role: 'CA' });
  if (!admin || !ca) throw new Error('Seed users missing');

  const adminToken = generateToken({ userId: admin._id.toString(), role: admin.role, email: admin.email });
  const caToken = generateToken({ userId: ca._id.toString(), role: ca.role, email: ca.email });
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const sample = await Invoice.findOne({ invoiceNumber: 'NAVKA-2026-0001' });
  if (!sample) throw new Error('Seed invoice NAVKA-2026-0001 missing');

  const server = app.listen(0);

  try {
    console.log('[Test 1] Unauthorized listing request...');
    const unauth = await request(server, { method: 'GET', path: '/api/invoices' });
    assert(unauth.status === 401, `Expected 401, got ${unauth.status}`);
    console.log('✓ Test 1 Passed: Missing token returns 401');

    console.log('[Test 2] Admin invoice listing with pagination...');
    const listRes = await request(server, {
      method: 'GET',
      path: '/api/invoices?page=1&limit=2',
      headers: auth(adminToken),
    });
    assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
    assert(listRes.body.success === true, 'success should be true');
    assert(Array.isArray(listRes.body.invoices), 'invoices array required');
    assert(listRes.body.invoices.length === 2, `Expected 2 invoices on page, got ${listRes.body.invoices.length}`);
    const pg = listRes.body.pagination;
    assert(pg.currentPage === 1, `currentPage expected 1, got ${pg.currentPage}`);
    assert(pg.limit === 2, `limit expected 2, got ${pg.limit}`);
    assert(pg.totalRecords === 5, `totalRecords expected 5, got ${pg.totalRecords}`);
    assert(pg.totalPages === 3, `totalPages expected 3, got ${pg.totalPages}`);
    console.log('✓ Test 2 Passed: Listing pagination metadata verified');

    console.log('[Test 3] Search by invoice number, Shopify order, customer, product, HSN...');
    const byNumber = await request(server, {
      method: 'GET',
      path: '/api/invoices?search=NAVKA-2026-0001',
      headers: auth(caToken),
    });
    assert(byNumber.status === 200, `Expected 200, got ${byNumber.status}`);
    assert(byNumber.body.pagination.totalRecords === 1, 'Invoice number search should return 1');
    assert(byNumber.body.invoices[0].invoiceNumber === 'NAVKA-2026-0001', 'Wrong invoice for number search');

    const byOrder = await request(server, {
      method: 'GET',
      path: '/api/invoices?search=shop_order_1002',
      headers: auth(caToken),
    });
    assert(byOrder.body.pagination.totalRecords === 1, 'Shopify order search should return 1');

    const byCustomer = await request(server, {
      method: 'GET',
      path: '/api/invoices?search=Sharma%20Retail',
      headers: auth(caToken),
    });
    assert(byCustomer.body.pagination.totalRecords >= 1, 'Customer search should match Sharma invoices');

    const byProduct = await request(server, {
      method: 'GET',
      path: '/api/invoices?product=Thermal%20Receipt',
      headers: auth(caToken),
    });
    assert(byProduct.body.pagination.totalRecords >= 1, 'Product search should match thermal printer invoices');

    const byHsn = await request(server, {
      method: 'GET',
      path: '/api/invoices?hsnSac=844332',
      headers: auth(caToken),
    });
    assert(byHsn.body.pagination.totalRecords >= 1, 'HSN search should match 844332');
    console.log('✓ Test 3 Passed: Search across invoice #, order, customer, product, HSN');

    console.log('[Test 4] Filters: payment status, invoice status, amount, date...');
    const paid = await request(server, {
      method: 'GET',
      path: '/api/invoices?paymentStatus=PAID',
      headers: auth(adminToken),
    });
    assert(paid.body.pagination.totalRecords === 2, `Expected 2 PAID, got ${paid.body.pagination.totalRecords}`);
    assert(paid.body.invoices.every((inv: any) => inv.paymentStatus === 'PAID'), 'All results must be PAID');

    const active = await request(server, {
      method: 'GET',
      path: '/api/invoices?invoiceStatus=ACTIVE',
      headers: auth(adminToken),
    });
    assert(active.body.pagination.totalRecords === 5, 'All seed invoices are ACTIVE');

    const amount = await request(server, {
      method: 'GET',
      path: '/api/invoices?minAmount=10000&maxAmount=50000',
      headers: auth(adminToken),
    });
    assert(amount.body.invoices.every((inv: any) => inv.grandTotal >= 10000 && inv.grandTotal <= 50000), 'Amount filter bounds');

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthRes = await request(server, {
      method: 'GET',
      path: `/api/invoices?month=${month}`,
      headers: auth(adminToken),
    });
    assert(monthRes.status === 200, 'Month filter should succeed');
    console.log('✓ Test 4 Passed: Payment, status, amount, and month filters');

    console.log('[Test 4b] Server-side sorting by grand total...');
    const asc = await request(server, {
      method: 'GET',
      path: '/api/invoices?sortBy=grandTotal&sortOrder=asc&limit=100',
      headers: auth(caToken),
    });
    const ascTotals: number[] = asc.body.invoices.map((inv: any) => inv.grandTotal);
    assert(ascTotals.every((v, i) => i === 0 || ascTotals[i - 1] <= v), 'grandTotal asc order');

    const desc = await request(server, {
      method: 'GET',
      path: '/api/invoices?sortBy=grandTotal&sortOrder=desc&limit=100',
      headers: auth(caToken),
    });
    const descTotals: number[] = desc.body.invoices.map((inv: any) => inv.grandTotal);
    assert(descTotals.every((v, i) => i === 0 || descTotals[i - 1] >= v), 'grandTotal desc order');

    const badSort = await request(server, {
      method: 'GET',
      path: '/api/invoices?sortBy=passwordHash',
      headers: auth(caToken),
    });
    assert(badSort.status === 200, `Unknown sortBy should fall back, got ${badSort.status}`);
    console.log('✓ Test 4b Passed: Sorting asc/desc and unknown sort field fallback');

    console.log('[Test 5] Invoice detail for Admin and CA...');
    const detailPath = `/api/invoices/${sample._id.toString()}`;
    const adminDetail = await request(server, { method: 'GET', path: detailPath, headers: auth(adminToken) });
    assert(adminDetail.status === 200, `Admin detail expected 200, got ${adminDetail.status}`);
    assert(adminDetail.body.invoice.invoiceNumber === 'NAVKA-2026-0001', 'Detail invoice number mismatch');
    assert(Array.isArray(adminDetail.body.invoice.items), 'Items required');
    assert(Array.isArray(adminDetail.body.payments), 'Payments array required');
    assert(adminDetail.body.payments.length >= 1, 'Paid invoice should include payment records');
    assert(adminDetail.body.summary.grandTotal === sample.grandTotal, 'Summary grand total mismatch');

    const caDetail = await request(server, { method: 'GET', path: detailPath, headers: auth(caToken) });
    assert(caDetail.status === 200, `CA detail expected 200, got ${caDetail.status}`);
    console.log('✓ Test 5 Passed: Invoice detail includes items, summary, and payments');

    console.log('[Test 6] Invalid and missing invoice IDs...');
    const badId = await request(server, {
      method: 'GET',
      path: '/api/invoices/not-a-valid-id',
      headers: auth(adminToken),
    });
    assert(badId.status === 400, `Expected 400 for invalid id, got ${badId.status}`);

    const missing = await request(server, {
      method: 'GET',
      path: `/api/invoices/${new mongoose.Types.ObjectId().toString()}`,
      headers: auth(adminToken),
    });
    assert(missing.status === 404, `Expected 404 for missing invoice, got ${missing.status}`);
    console.log('✓ Test 6 Passed: Invalid ID 400, missing invoice 404');

    console.log('[Test 7] CA cannot mutate invoices; Admin mutation path is authorized...');
    const caPost = await request(server, {
      method: 'POST',
      path: '/api/invoices',
      headers: auth(caToken),
      body: { invoiceNumber: 'SHOULD-NOT-CREATE' },
    });
    assert(caPost.status === 403, `CA POST expected 403, got ${caPost.status}`);

    const caPut = await request(server, {
      method: 'PUT',
      path: detailPath,
      headers: auth(caToken),
      body: { invoiceStatus: 'CANCELLED' },
    });
    assert(caPut.status === 403, `CA PUT expected 403, got ${caPut.status}`);

    const adminPost = await request(server, {
      method: 'POST',
      path: '/api/invoices',
      headers: auth(adminToken),
      body: { invoiceNumber: 'SHOULD-NOT-CREATE' },
    });
    assert(adminPost.status === 400, `Admin POST with invalid body expected 400, got ${adminPost.status}`);
    console.log('✓ Test 7 Passed: CA mutations 403; Admin POST passes RBAC and hits validation');

    console.log('[Test 8] HSN/SAC mappings: CA view-only, Admin update...');
    const hsnListCa = await request(server, {
      method: 'GET',
      path: '/api/hsn-mappings',
      headers: auth(caToken),
    });
    assert(hsnListCa.status === 200, `CA HSN list expected 200, got ${hsnListCa.status}`);
    assert(Array.isArray(hsnListCa.body.mappings) && hsnListCa.body.mappings.length >= 5, 'HSN mappings should list products');

    const caHsnWrite = await request(server, {
      method: 'POST',
      path: '/api/hsn-mappings',
      headers: auth(caToken),
      body: { name: 'Blocked', hsnSac: '999999' },
    });
    assert(caHsnWrite.status === 403, `CA HSN create expected 403, got ${caHsnWrite.status}`);

    const mappingId = hsnListCa.body.mappings[0]._id;
    const caHsnPut = await request(server, {
      method: 'PUT',
      path: `/api/hsn-mappings/${mappingId}`,
      headers: auth(caToken),
      body: { hsnSac: '000000' },
    });
    assert(caHsnPut.status === 403, `CA HSN update expected 403, got ${caHsnPut.status}`);

    const adminHsnPut = await request(server, {
      method: 'PUT',
      path: `/api/hsn-mappings/${mappingId}`,
      headers: auth(adminToken),
      body: { hsnSac: hsnListCa.body.mappings[0].hsnSac },
    });
    assert(adminHsnPut.status === 200, `Admin HSN update expected 200, got ${adminHsnPut.status}`);
    console.log('✓ Test 8 Passed: HSN/SAC mapping RBAC (CA view, Admin write)');

    console.log('\n======================================================');
    console.log(' ALL PHASE 6 INVOICE MANAGEMENT TESTS PASSED!          ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

testInvoices().catch((err) => {
  console.error('Invoice test failed:', err);
  process.exit(1);
});
