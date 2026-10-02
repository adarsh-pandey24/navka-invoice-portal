import { assert } from './assert';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import { Invoice, Payment } from '../models';
import { ShopifyService } from '../services/shopifyService';
import { manualInvoicePayload, near, request, seededTokens } from './http';

async function testPayments() {
  console.log('\n--- Starting Phase 8: Unified Payment Ledger Verification Tests ---\n');
  await connectDB();
  await seedAllData();
  const { admin, ca } = await seededTokens();
  const server = app.listen(0);
  const get = (path: string, headers = ca) => request(server, { method: 'GET', path, headers });
  const post = (path: string, body: unknown, headers = admin) => request(server, { method: 'POST', path, headers, body });
  const put = (path: string, body: unknown, headers = admin) => request(server, { method: 'PUT', path, headers, body });

  try {
    console.log('[Test 1] Unified ledger listing, summary and filters (CA)...');
    const all = await get('/api/payments?limit=50');
    assert(all.status === 200, `ledger 200, got ${all.status}`);
    assert(all.body.pagination.totalRecords === 4, `4 seed payments, got ${all.body.pagination.totalRecords}`);
    assert(all.body.payments[0].invoiceId.invoiceNumber, 'invoice populated');
    const completed = await Payment.find({ paymentStatus: 'COMPLETED' });
    const expected = completed.reduce((s, p) => s + p.amount, 0);
    assert(near(all.body.summary.totalReceived, expected), `totalReceived ${all.body.summary.totalReceived} vs ${expected}`);
    assert(near(all.body.summary.onlineReceived + all.body.summary.offlineReceived, all.body.summary.totalReceived), 'online+offline');

    const offline = await get('/api/payments?source=OFFLINE');
    assert(offline.body.pagination.totalRecords === 2, 'OFFLINE filter');
    assert(offline.body.payments.every((p: any) => p.paymentSource === 'OFFLINE'), 'all offline');
    const cheque = await get('/api/payments?method=CHEQUE');
    assert(cheque.body.pagination.totalRecords === 1, 'CHEQUE filter');
    const refunded = await get('/api/payments?status=REFUNDED');
    assert(refunded.body.pagination.totalRecords === 1, 'status filter');
    const amount = await get('/api/payments?minAmount=10000&maxAmount=10000');
    assert(amount.body.pagination.totalRecords === 1 && amount.body.payments[0].amount === 10000, 'amount range');
    const search = await get('/api/payments?search=NAVKA-2026-0002');
    assert(search.body.pagination.totalRecords === 1, `search by invoice number, got ${search.body.pagination.totalRecords}`);
    const future = await get('/api/payments?startDate=2099-01-01');
    assert(future.body.pagination.totalRecords === 0, 'future date range empty');
    const badDate = await get('/api/payments?startDate=not-a-date');
    assert(badDate.status === 200 && badDate.body.pagination.totalRecords === 4, 'invalid date ignored, not 500');
    const paged = await get('/api/payments?limit=3&page=2');
    assert(paged.body.payments.length === 1 && paged.body.pagination.totalPages === 2, 'pagination');
    console.log('✓ Test 1 Passed: ledger, totals (COMPLETED only), filters, search, pagination');

    const pending = await Invoice.findOne({ invoiceNumber: 'NAVKA-2026-0004' });
    const refundedInv = await Invoice.findOne({ invoiceNumber: 'NAVKA-2026-0003' });
    if (!pending || !refundedInv) throw new Error('seed invoices missing');
    const pendingId = pending._id.toString();

    console.log('[Test 2] CA is view-only on payments...');
    const caPost = await post('/api/payments', { invoiceId: pendingId, amount: 1, paymentMethod: 'CASH' }, ca);
    assert(caPost.status === 403, `CA POST 403, got ${caPost.status}`);
    const caPut = await put(`/api/payments/${all.body.payments[0]._id}`, { notes: 'x' }, ca);
    assert(caPut.status === 403, `CA PUT 403, got ${caPut.status}`);
    console.log('✓ Test 2 Passed: CA POST/PUT -> 403');

    console.log('[Test 3] Offline payment validation...');
    const invalid: Array<[string, unknown, number]> = [
      ['cheque without reference', { invoiceId: pendingId, amount: 100, paymentMethod: 'CHEQUE' }, 400],
      ['ONLINE is not offline', { invoiceId: pendingId, amount: 100, paymentMethod: 'ONLINE' }, 400],
      ['negative amount', { invoiceId: pendingId, amount: -5, paymentMethod: 'CASH' }, 400],
      ['future date', { invoiceId: pendingId, amount: 100, paymentMethod: 'CASH', paymentDate: '2099-01-01' }, 400],
      ['bad invoice id', { invoiceId: 'nope', amount: 100, paymentMethod: 'CASH' }, 400],
      ['unknown invoice', { invoiceId: '64b000000000000000000000', amount: 100, paymentMethod: 'CASH' }, 404],
      ['refunded invoice', { invoiceId: refundedInv._id.toString(), amount: 100, paymentMethod: 'CASH' }, 400],
      ['overpayment', { invoiceId: pendingId, amount: pending.grandTotal + 1, paymentMethod: 'CASH' }, 400],
    ];
    for (const [label, body, status] of invalid) {
      const res = await post('/api/payments', body);
      assert(res.status === status, `${label}: expected ${status}, got ${res.status} (${res.body?.message})`);
    }
    console.log(`✓ Test 3 Passed: ${invalid.length} invalid payments rejected`);

    console.log('[Test 4] Partial then full payment reconciles invoice status...');
    const half = Math.floor(pending.grandTotal / 2);
    const p1 = await post('/api/payments', {
      invoiceId: pendingId,
      amount: half,
      paymentMethod: 'BANK_TRANSFER',
      referenceId: 'UTR123456',
      paymentDate: '2026-09-15',
    });
    assert(p1.status === 201, `partial 201, got ${p1.status}: ${p1.body?.message}`);
    assert(p1.body.updatedInvoiceStatus === 'PARTIAL', `PARTIAL, got ${p1.body.updatedInvoiceStatus}`);
    assert(near(p1.body.balanceDue, pending.grandTotal - half), 'balance after partial');
    assert(p1.body.payment.paymentSource === 'OFFLINE' && p1.body.payment.recordedBy, 'offline + recordedBy');

    const detail = await get(`/api/invoices/${pendingId}`);
    assert(near(detail.body.summary.amountPaid, half) && near(detail.body.summary.balanceDue, pending.grandTotal - half), 'detail balance');

    const tooMuch = await post('/api/payments', { invoiceId: pendingId, amount: pending.grandTotal - half + 1, paymentMethod: 'CASH' });
    assert(tooMuch.status === 400, 'cannot exceed remaining balance');
    const p2 = await post('/api/payments', { invoiceId: pendingId, amount: pending.grandTotal - half, paymentMethod: 'CASH' });
    assert(p2.status === 201 && p2.body.updatedInvoiceStatus === 'PAID', `PAID, got ${p2.body.updatedInvoiceStatus}`);
    const again = await post('/api/payments', { invoiceId: pendingId, amount: 1, paymentMethod: 'CASH' });
    assert(again.status === 400, 'fully paid invoice rejects more payments');
    console.log('✓ Test 4 Passed: PENDING -> PARTIAL -> PAID, overpayment blocked');

    console.log('[Test 5] Editing offline payments re-reconciles; online payments are locked...');
    const failed = await put(`/api/payments/${p2.body.payment._id}`, { paymentStatus: 'FAILED', notes: 'Bounced' });
    assert(failed.status === 200 && failed.body.updatedInvoiceStatus === 'PARTIAL', `FAILED -> PARTIAL, got ${failed.body.updatedInvoiceStatus}`);
    const restored = await put(`/api/payments/${p2.body.payment._id}`, { paymentStatus: 'COMPLETED' });
    assert(restored.body.updatedInvoiceStatus === 'PAID', 'COMPLETED again -> PAID');
    const ref = await put(`/api/payments/${p1.body.payment._id}`, { referenceId: 'UTR999' });
    assert(ref.status === 200 && ref.body.payment.referenceId === 'UTR999', 'reference updated');
    const onlinePayment = await Payment.findOne({ paymentSource: 'ONLINE' });
    const onlineEdit = await put(`/api/payments/${onlinePayment!._id}`, { notes: 'x' });
    assert(onlineEdit.status === 400, `online edit 400, got ${onlineEdit.status}`);
    const emptyEdit = await put(`/api/payments/${p1.body.payment._id}`, {});
    assert(emptyEdit.status === 400, 'empty update 400');
    console.log('✓ Test 5 Passed: status edits reconcile, online payments read-only');

    console.log('[Test 6] Cancelled invoices reject payments; invoice PUT rules...');
    const created = await post('/api/invoices', manualInvoicePayload());
    const manualId = created.body.invoice._id;
    const caCancel = await put(`/api/invoices/${manualId}`, { invoiceStatus: 'CANCELLED' }, ca);
    assert(caCancel.status === 403, 'CA cannot cancel');
    const notes = await put(`/api/invoices/${manualId}`, { notes: 'Updated note' });
    assert(notes.status === 200 && notes.body.invoice.notes === 'Updated note', 'notes updated');
    const cancel = await put(`/api/invoices/${manualId}`, { invoiceStatus: 'CANCELLED' });
    assert(cancel.status === 200 && cancel.body.invoice.invoiceStatus === 'CANCELLED', 'cancelled');
    const reactivate = await put(`/api/invoices/${manualId}`, { invoiceStatus: 'ACTIVE' });
    assert(reactivate.status === 400, 'reactivation blocked');
    const payCancelled = await post('/api/payments', { invoiceId: manualId, amount: 10, paymentMethod: 'CASH' });
    assert(payCancelled.status === 400, 'no payments on cancelled invoice');
    const shopifyEdit = await put(`/api/invoices/${pendingId}`, { notes: 'x' });
    assert(shopifyEdit.status === 400, 'Shopify invoices not editable');
    const emptyPut = await put(`/api/invoices/${manualId}`, {});
    assert(emptyPut.status === 400, 'empty invoice update 400');
    console.log('✓ Test 6 Passed: cancel, notes, reactivation and Shopify guards');

    console.log('[Test 7] Shopify re-sync keeps offline payments on unpaid orders...');
    await ShopifyService.syncAll();
    const cod = await Invoice.findOne({ source: 'SHOPIFY', paymentStatus: 'PENDING', shopifyOrderId: { $exists: true }, invoiceNumber: /^NAVKA-SHP-/ });
    assert(cod, 'a pending synced Shopify order exists');
    const codPay = await post('/api/payments', { invoiceId: cod!._id.toString(), amount: cod!.grandTotal, paymentMethod: 'CASH' });
    assert(codPay.body.updatedInvoiceStatus === 'PAID', 'COD paid offline');
    await ShopifyService.syncAll();
    const afterSync = await Invoice.findById(cod!._id);
    assert(afterSync!.paymentStatus === 'PAID', `re-sync must keep PAID, got ${afterSync!.paymentStatus}`);
    console.log('✓ Test 7 Passed: re-sync does not reset offline-paid orders');

    console.log('[Test 8] Ledger export CSV / Excel (CA), formula injection neutralised...');
    const evil = await post('/api/invoices', manualInvoicePayload({ customer: { name: '=HYPERLINK("http://evil")' } }));
    await post('/api/payments', { invoiceId: evil.body.invoice._id, amount: 100, paymentMethod: 'CASH', notes: '+cmd' });
    const csv = await get('/api/payments/export?format=csv');
    assert(csv.status === 200 && String(csv.headers['content-type']).startsWith('text/csv'), 'csv content-type');
    const text = csv.raw.toString('utf8');
    assert(text.charCodeAt(0) === 0xfeff, 'CSV has UTF-8 BOM');
    assert(text.includes('Invoice Number') && text.includes('NAVKA-2026-0002'), 'CSV header and rows');
    assert(text.includes(`"'=HYPERLINK(""http://evil"")"`) && text.includes("'+cmd"), 'formula cells prefixed');
    assert(!/(^|,)=HYPERLINK/m.test(text), 'no raw formula cell');
    const xlsx = await get('/api/payments/export?format=excel&source=OFFLINE');
    assert(xlsx.status === 200 && xlsx.raw.subarray(0, 2).toString() === 'PK', 'xlsx zip');
    const badFormat = await get('/api/payments/export?format=xml');
    assert(badFormat.status === 400, 'bad format 400');
    console.log('✓ Test 8 Passed: exports stream for CA, injection-safe');

    console.log('[Test 9] Business settings: CA read-only, Admin update applies to new invoices...');
    const caSettings = await put('/api/settings', { businessName: 'X' }, ca);
    assert(caSettings.status === 403, 'CA settings PUT 403');
    const current = (await get('/api/settings')).body.settings;
    const base = {
      businessName: current.businessName,
      address: current.address,
      gstin: current.gstin,
      contactEmail: current.contactEmail,
      contactPhone: current.contactPhone,
      invoicePrefix: current.invoicePrefix,
      bankDetails: current.bankDetails,
    };
    const badGstin = await put('/api/settings', { ...base, gstin: 'BAD' });
    assert(badGstin.status === 400, 'invalid GSTIN 400');
    const badPrefix = await put('/api/settings', { ...base, invoicePrefix: 'NA-VKA' });
    assert(badPrefix.status === 400, 'invalid prefix 400');
    const badIfsc = await put('/api/settings', { ...base, bankDetails: { ...base.bankDetails, ifscCode: 'HDFC123' } });
    assert(badIfsc.status === 400, 'invalid IFSC 400');
    const ok = await put('/api/settings', { ...base, invoicePrefix: 'nvk', businessName: 'NAVKA Test Pvt Ltd' });
    assert(ok.status === 200 && ok.body.settings.invoicePrefix === 'NVK', 'prefix upper-cased and saved');
    const withPrefix = await post('/api/invoices', manualInvoicePayload());
    assert(withPrefix.body.invoice.invoiceNumber.startsWith('NVK-'), `new prefix used, got ${withPrefix.body.invoice.invoiceNumber}`);
    assert(withPrefix.body.invoice.businessDetails.name === 'NAVKA Test Pvt Ltd', 'new business name on new invoice');
    const old = await Invoice.findOne({ invoiceNumber: 'NAVKA-2026-0001' });
    assert(old!.businessDetails.name !== 'NAVKA Test Pvt Ltd', 'existing invoices unchanged');
    await put('/api/settings', base);
    console.log('✓ Test 9 Passed: settings validation and RBAC');

    console.log('\n======================================================');
    console.log(' ALL PHASE 8 PAYMENT LEDGER TESTS PASSED!             ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

testPayments().catch((err) => {
  console.error('Payment test failed:', err);
  process.exit(1);
});
