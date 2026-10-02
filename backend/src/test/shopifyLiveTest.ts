/**
 * Phase 5 - verifies the LIVE Shopify code path (pagination, rate limits, tax-inclusive
 * prices, shipping, refunds, guests, cancellation, failure handling) against a local fake
 * Shopify server. No real Shopify calls and no mock-data fallback are involved.
 */
import http from 'http';
import { assert } from './assert';

const PORT = 4599;
process.env.SHOPIFY_ACCESS_TOKEN = 'shpat_live_test_token_0000000000000';
process.env.SHOPIFY_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SHOPIFY_RETRY_BASE_MS = '5';
process.env.SHOPIFY_MAX_RETRIES = '3';
process.env.NODE_ENV = 'test';

const mkOrder = (id: number, over: any = {}) => ({
  id, order_number: id - 5000, name: `#${id - 5000}`, created_at: new Date().toISOString(),
  financial_status: 'paid', taxes_included: false, total_price: '1180.00',
  current_subtotal_price: '1000.00', total_tax: '180.00', current_total_price: '1180.00', total_discounts: '0.00',
  payment_gateway_names: ['razorpay'],
  customer: { id: id, first_name: 'Cust', last_name: String(id), email: `c${id}@example.com` },
  billing_address: { first_name: 'Cust', last_name: String(id), city: 'Delhi', province: 'Delhi', zip: '110001', country: 'India' },
  line_items: [{ id: id * 10, product_id: 42, title: 'Widget', quantity: 1, price: '1000.00', total_discount: '0.00', sku: 'W-1',
    tax_lines: [{ title: 'GST', price: '180.00', rate: 0.18 }] }],
  ...over,
});

let requestLog: string[] = [];
let rateLimitOnce = true;
let mode: 'ok' | 'unauthorized' | 'down' = 'ok';

const page1 = [mkOrder(5001), mkOrder(5002)];
const page2 = [
  // tax-inclusive: Rs 1180 gross incl 18% GST (Rs 180), plus taxed shipping Rs 118 incl GST Rs 18
  mkOrder(5003, { taxes_included: true, total_price: '1298.00',
    line_items: [{ id: 1, title: 'Inclusive Item', quantity: 1, price: '1180.00', total_discount: '0.00',
      tax_lines: [{ title: 'GST', price: '180.00', rate: 0.18 }] }],
    shipping_lines: [{ title: 'Standard', price: '118.00', tax_lines: [{ title: 'GST', price: '18.00', rate: 0.18 }] }] }),
  // guest order: no customer, no email
  mkOrder(5004, { customer: undefined, billing_address: { first_name: 'Walk', last_name: 'In', city: 'Pune' } }),
  // two refunds (300 + 200), partial
  mkOrder(5005, { financial_status: 'partially_refunded', refunds: [
    { id: 1, created_at: '2026-09-01T10:00:00Z', note: 'damaged', transactions: [{ amount: '300.00', status: 'success' }] },
    { id: 2, created_at: '2026-09-05T10:00:00Z', note: 'late', transactions: [{ amount: '200.00', status: 'success' }, { amount: '50.00', status: 'failure' }] } ] }),
  // cancelled
  mkOrder(5006, { cancelled_at: '2026-09-02T00:00:00Z', financial_status: 'voided' }),
  // tax-exempt: no tax lines must mean 0% GST (not an invented 18%)
  mkOrder(5007, { total_price: '500.00', line_items: [{ id: 7, title: 'Exempt Book', quantity: 2, price: '250.00', total_discount: '0.00', tax_lines: [] }] }),
];

const server = http.createServer((req, res) => {
  requestLog.push(req.url || '');
  if (mode === 'unauthorized') { res.statusCode = 401; return res.end('{}'); }
  if (mode === 'down') { res.statusCode = 503; return res.end('{}'); }
  if (req.headers['x-shopify-access-token'] !== process.env.SHOPIFY_ACCESS_TOKEN) { res.statusCode = 401; return res.end('{}'); }
  const url = new URL(req.url || '', `http://127.0.0.1:${PORT}`);
  if (url.searchParams.get('page_info') === 'p2') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ orders: page2 }));
  }
  if (rateLimitOnce) { rateLimitOnce = false; res.statusCode = 429; res.setHeader('Retry-After', '0'); return res.end('{}'); }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Link', `<http://127.0.0.1:${PORT}/admin/api/2024-01/orders.json?limit=250&page_info=p2>; rel="next"`);
  res.end(JSON.stringify({ orders: page1 }));
});

(async () => {
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
  const { connectDB, disconnectDB } = await import('../config/db.js');
  const { Invoice, Payment, Customer } = await import('../models/index.js');
  const { ShopifyService } = await import('../services/shopifyService.js');
  await connectDB();

  try {
    await Invoice.deleteMany({ source: 'SHOPIFY', shopifyOrderId: { $in: ['5001','5002','5003','5004','5005','5006','5007'] } });

    console.log('[Test 1] Live mode detected (not demo) ...');
    assert(!ShopifyService.isDemoMode(), 'live token must not be treated as demo');
    console.log('✓ Test 1 Passed');

    console.log('[Test 2] Pagination (2 pages) + 429 rate-limit retry ...');
    const result = await ShopifyService.syncAll();
    assert(result.count === 7, `expected 7 orders across 2 pages, got ${result.count}`);
    assert(result.failed.length === 0, `no failures expected: ${JSON.stringify(result.failed)}`);
    assert(requestLog.length >= 3, `expected 429 retry + 2 pages (>=3 requests), got ${requestLog.length}`);
    console.log(`✓ Test 2 Passed: ${result.count} orders, ${requestLog.length} HTTP requests (incl. one 429 retry)`);

    console.log('[Test 3] Tax-inclusive prices + shipping converted to ex-tax maths ...');
    const inc = await Invoice.findOne({ shopifyOrderId: '5003' });
    assert(inc, 'invoice 5003 exists');
    assert(inc.items.length === 2, `item + shipping line expected, got ${inc.items.length}`);
    assert(Math.abs(inc.items[0].taxableAmount - 1000) < 0.01, `taxable should be 1000, got ${inc.items[0].taxableAmount}`);
    assert(inc.items[0].gstRate === 18, 'gst rate 18');
    assert(inc.items[1].hsnSac === '996812', 'shipping SAC');
    assert(Math.abs(inc.taxableAmount - 1100) < 0.01, `invoice taxable 1100, got ${inc.taxableAmount}`);
    assert(Math.abs(inc.totalGST - 198) < 0.01, `invoice GST 198, got ${inc.totalGST}`);
    assert(inc.grandTotal === 1298, `grand total 1298 (matches Shopify), got ${inc.grandTotal}`);
    console.log('✓ Test 3 Passed: taxable 1100 + GST 198 = 1298 (matches Shopify total)');

    console.log('[Test 4] Guest order is not merged into an unrelated customer ...');
    const guest = await Invoice.findOne({ shopifyOrderId: '5004' });
    assert(guest, 'guest invoice');
    const guestCust = await Customer.findById(guest.customer.customerId);
    assert(guestCust && guestCust.name === 'Walk In', `guest linked to wrong customer: ${guestCust?.name}`);
    const walkCount = await Customer.countDocuments({ name: 'Walk In' });
    await ShopifyService.syncAll();
    assert((await Customer.countDocuments({ name: 'Walk In' })) === walkCount, 're-sync must not duplicate guest customer');
    console.log('✓ Test 4 Passed');

    console.log('[Test 5] Multiple refunds summed, failed refund transaction ignored ...');
    const ref = await Invoice.findOne({ shopifyOrderId: '5005' });
    assert(ref && ref.refundDetails?.refundAmount === 500, `refund should be 500, got ${ref?.refundDetails?.refundAmount}`);
    assert(ref.paymentStatus === 'REFUNDED', 'planner maps partially_refunded -> REFUNDED');
    const refPay = await Payment.findOne({ invoiceId: ref._id });
    assert(refPay && refPay.paymentStatus === 'COMPLETED', `partial refund keeps payment COMPLETED, got ${refPay?.paymentStatus}`);
    console.log('✓ Test 5 Passed: refund 500 (300+200), payment stays COMPLETED');

    console.log('[Test 6] Cancelled order -> CANCELLED invoice ...');
    const canc = await Invoice.findOne({ shopifyOrderId: '5006' });
    assert(canc && canc.invoiceStatus === 'CANCELLED', `expected CANCELLED, got ${canc?.invoiceStatus}`);
    console.log('✓ Test 6 Passed');

    console.log('[Test 7] No tax lines => 0% GST, unknown HSN is visible (not a wrong real code) ...');
    const ex = await Invoice.findOne({ shopifyOrderId: '5007' });
    assert(ex && ex.totalGST === 0 && ex.items[0].gstRate === 0, `expected 0 GST, got ${ex?.totalGST}`);
    assert(ex.items[0].hsnSac === 'UNMAPPED', `expected UNMAPPED, got ${ex.items[0].hsnSac}`);
    console.log('✓ Test 7 Passed');

    console.log('[Test 8] Idempotency: second full sync created no duplicates ...');
    assert((await Invoice.countDocuments({ shopifyOrderId: { $in: ['5001','5002','5003','5004','5005','5006','5007'] } })) === 7, 'invoice count must stay 7');
    assert((await Payment.countDocuments({ orderId: { $in: ['#1','#2'] }, invoiceId: { $in: (await Invoice.find({ shopifyOrderId: { $in: ['5001','5002'] } })).map(i => i._id) } })) === 2, 'payments must not duplicate');
    console.log('✓ Test 8 Passed');

    console.log('[Test 9] Bad credentials -> clear 502 error, NO mock data imported ...');
    mode = 'unauthorized';
    const before = await Invoice.countDocuments();
    let err: any;
    try { await ShopifyService.syncAll(); } catch (e) { err = e; }
    assert(err && err.statusCode === 502 && /credentials/i.test(err.message), `expected 502 credentials error, got ${err?.message}`);
    assert((await Invoice.countDocuments()) === before, 'no invoices may be created on failure');
    console.log(`✓ Test 9 Passed: ${err.message}`);

    console.log('[Test 10] Shopify outage (503) -> retries then 502, NO mock fallback ...');
    mode = 'down'; requestLog = [];
    err = undefined;
    try { await ShopifyService.syncAll(); } catch (e) { err = e; }
    assert(err && err.statusCode === 502, `expected 502, got ${err?.statusCode}`);
    assert(requestLog.length === 4, `1 try + 3 retries expected, got ${requestLog.length}`);
    assert((await Invoice.countDocuments()) === before, 'no invoices may be created on outage');
    console.log(`✓ Test 10 Passed: gave up after ${requestLog.length} attempts`);

    console.log('\n======================================================');
    console.log(' ALL PHASE 5 LIVE-PATH SHOPIFY TESTS PASSED!');
    console.log('======================================================\n');
  } finally {
    await Invoice.deleteMany({ shopifyOrderId: { $in: ['5001','5002','5003','5004','5005','5006','5007'] } });
    await disconnectDB();
    server.close();
  }
})().catch((e) => { console.error('Live Shopify test failed:', e.message); server.close(); process.exit(1); });
