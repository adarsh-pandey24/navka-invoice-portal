import { assert } from './assert';
import http from 'http';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import { User, Invoice } from '../models';
import { generateToken } from '../utils/jwt';
import { calculateInvoice, splitGst, summarizeByHsn } from '../services/calculationService';
import { getSupplyType } from '../utils/gstState';
import { convertAmountToWords } from '../utils/numberToWords';

const request = (
  server: http.Server,
  options: { method: string; path: string; headers?: Record<string, string>; body?: unknown }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; raw: Buffer; body: any }> => {
  return new Promise((resolve, reject) => {
    const port = (server.address() as any).port;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: options.path,
        method: options.method,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let body: any = undefined;
          if ((res.headers['content-type'] || '').includes('application/json')) {
            body = JSON.parse(raw.toString('utf8'));
          }
          resolve({ status: res.statusCode || 500, headers: res.headers, raw, body });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
};

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

function testCalculations() {
  console.log('[Test 1] Calculation service formulas, rounding, and amount in words...');
  const result = calculateInvoice([
    { productName: 'Printer', hsnSac: '844332', quantity: 3, unitPrice: 1999.99, discount: 7.5, gstRate: 18 },
    { productName: 'Paper', hsnSac: '481190', quantity: 10, unitPrice: 45.5, discount: 0, gstRate: 12 },
    { productName: 'Exempt', hsnSac: '4901', quantity: 1, unitPrice: 100, discount: 100, gstRate: 0 },
  ]);
  const [a, b, c] = result.items;
  // Line 1: gross 5999.97, discount 449.9978 -> 450.00, taxable 5549.97, GST 998.9946 -> 998.99
  assert(near(a.discount, 450), `line1 discount 450, got ${a.discount}`);
  assert(near(a.taxableAmount, 5549.97), `line1 taxable 5549.97, got ${a.taxableAmount}`);
  assert(near(a.gstAmount, 998.99), `line1 GST 998.99, got ${a.gstAmount}`);
  assert(near(a.totalAmount, 6548.96), `line1 total 6548.96, got ${a.totalAmount}`);
  assert(near(b.taxableAmount, 455) && near(b.gstAmount, 54.6), 'line2 taxable 455 / GST 54.6');
  assert(c.taxableAmount === 0 && c.gstAmount === 0, '100% discount line is zero');

  assert(near(result.subtotal, 6554.97), `subtotal 6554.97, got ${result.subtotal}`);
  assert(near(result.discount, 550), `discount 550, got ${result.discount}`);
  assert(near(result.taxableAmount, 6004.97), `taxable 6004.97, got ${result.taxableAmount}`);
  assert(near(result.totalGST, 1053.59), `GST 1053.59, got ${result.totalGST}`);
  // 7058.56 -> 7059, round off +0.44
  assert(result.grandTotal === 7059, `grand total 7059, got ${result.grandTotal}`);
  assert(near(result.roundOff, 0.44), `round off 0.44, got ${result.roundOff}`);
  assert(near(result.taxableAmount + result.totalGST + result.roundOff, result.grandTotal), 'totals reconcile');
  assert(result.amountInWords === convertAmountToWords(7059), 'amount in words');
  assert(result.amountInWords === 'Rupees Seven Thousand Fifty Nine Only', `words: ${result.amountInWords}`);

  const down = calculateInvoice([{ productName: 'X', hsnSac: '1234', quantity: 1, unitPrice: 100.3, discount: 0, gstRate: 0 }]);
  assert(down.grandTotal === 100 && near(down.roundOff, -0.3), 'negative round off');
  console.log('✓ Test 1 Passed: line maths, totals, round off, and words');

  console.log('[Test 2] Place of supply and CGST/SGST/IGST split...');
  assert(getSupplyType('07AAAAA0000A1Z5', { state: 'Delhi' }) === 'INTRA_STATE', 'Delhi -> Delhi intra');
  assert(getSupplyType('07AAAAA0000A1Z5', { state: 'New Delhi' }) === 'INTRA_STATE', 'New Delhi alias intra');
  assert(getSupplyType('07AAAAA0000A1Z5', { state: 'Maharashtra' }) === 'INTER_STATE', 'Delhi -> Maharashtra inter');
  assert(getSupplyType('07AAAAA0000A1Z5', { gstin: '06AACCA5543C1Z2', state: 'Delhi' }) === 'INTER_STATE', 'GSTIN state wins');
  assert(getSupplyType('07AAAAA0000A1Z5', {}) === 'INTRA_STATE', 'unknown state defaults to intra');

  const intra = splitGst(54.61, 'INTRA_STATE');
  assert(near(intra.cgst + intra.sgst, 54.61) && intra.igst === 0, 'intra split sums to GST');
  const inter = splitGst(54.61, 'INTER_STATE');
  assert(inter.igst === 54.61 && inter.cgst === 0 && inter.sgst === 0, 'inter is all IGST');

  const hsn = summarizeByHsn(
    [
      { hsnSac: '844332', gstRate: 18, taxableAmount: 100, gstAmount: 18 },
      { hsnSac: '844332', gstRate: 18, taxableAmount: 50, gstAmount: 9 },
      { hsnSac: '481190', gstRate: 12, taxableAmount: 10, gstAmount: 1.2 },
    ],
    'INTRA_STATE'
  );
  assert(hsn.length === 2 && hsn[0].taxableAmount === 150 && hsn[0].gstAmount === 27, 'HSN grouping');
  assert(near(hsn[0].cgst, 13.5) && near(hsn[0].sgst, 13.5), 'HSN row split');
  console.log('✓ Test 2 Passed: supply type and tax split');
}

async function testApi() {
  await connectDB();
  await seedAllData();

  const admin = await User.findOne({ role: 'ADMIN' });
  const ca = await User.findOne({ role: 'CA' });
  if (!admin || !ca) throw new Error('Seed users missing');
  const auth = (u: typeof admin) => ({
    Authorization: `Bearer ${generateToken({ userId: u._id.toString(), role: u.role, email: u.email })}`,
  });

  const server = app.listen(0);
  try {
    const payload = {
      customer: {
        name: 'Phase Seven Traders',
        email: 'accounts@p7.example',
        phone: '+91 90000 00007',
        gstin: '27aaacp1234q1z5',
        billingAddress: { street: '7 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', country: 'India' },
        shippingAddress: { street: '', city: '', state: '', pincode: '', country: '' },
      },
      items: [
        { productName: 'Printer', hsnSac: '844332', quantity: 3, unitPrice: 1999.99, discount: 7.5, gstRate: 18 },
        { productName: 'Paper', hsnSac: '481190', quantity: 10, unitPrice: 45.5, discount: 0, gstRate: 12 },
      ],
      invoiceDate: '2026-10-01',
      dueDate: '2026-10-31',
      notes: 'Net 30',
      // Tampered client totals must be ignored.
      grandTotal: 1,
      totalGST: 0,
      invoiceNumber: 'HACKED-0001',
      paymentStatus: 'PAID',
    };

    console.log('[Test 3] CA cannot create invoices...');
    const caPost = await request(server, { method: 'POST', path: '/api/invoices', headers: auth(ca), body: payload });
    assert(caPost.status === 403, `CA POST expected 403, got ${caPost.status}`);
    console.log('✓ Test 3 Passed: CA POST /api/invoices -> 403');

    console.log('[Test 4] Validation errors...');
    const invalidCases: Array<[string, unknown]> = [
      ['no items', { ...payload, items: [] }],
      ['no customer name', { ...payload, customer: { ...payload.customer, name: ' ' } }],
      ['bad GST rate', { ...payload, items: [{ ...payload.items[0], gstRate: 15 }] }],
      ['zero qty', { ...payload, items: [{ ...payload.items[0], quantity: 0 }] }],
      ['discount > 100', { ...payload, items: [{ ...payload.items[0], discount: 120 }] }],
      ['UNMAPPED HSN', { ...payload, items: [{ ...payload.items[0], hsnSac: 'UNMAPPED' }] }],
      ['bad GSTIN', { ...payload, customer: { ...payload.customer, gstin: 'NOTAGSTIN' } }],
      ['due before invoice', { ...payload, dueDate: '2026-09-01' }],
    ];
    for (const [label, body] of invalidCases) {
      const res = await request(server, { method: 'POST', path: '/api/invoices', headers: auth(admin), body });
      assert(res.status === 400, `${label}: expected 400, got ${res.status}`);
      assert(res.body.success === false && typeof res.body.message === 'string', `${label}: error message`);
    }
    console.log(`✓ Test 4 Passed: ${invalidCases.length} invalid payloads rejected with 400`);

    console.log('[Test 5] Admin creates invoice; server recalculates authoritatively...');
    const created = await request(server, { method: 'POST', path: '/api/invoices', headers: auth(admin), body: payload });
    assert(created.status === 201, `Expected 201, got ${created.status}: ${JSON.stringify(created.body)}`);
    const inv = created.body.invoice;
    assert(/^NAVKA-202610-\d{4}$/.test(inv.invoiceNumber), `number format NAVKA-YYYYMM-XXXX, got ${inv.invoiceNumber}`);
    assert(inv.grandTotal === 7059, `server grand total 7059, got ${inv.grandTotal}`);
    assert(near(inv.totalGST, 1053.59), `server GST 1053.59, got ${inv.totalGST}`);
    assert(inv.paymentStatus === 'PENDING' && inv.source === 'MANUAL' && inv.invoiceStatus === 'ACTIVE', 'defaults');
    assert(inv.customer.gstin === '27AAACP1234Q1Z5', 'GSTIN upper-cased');
    assert(inv.customer.shippingAddress.city === 'Pune', 'blank shipping address falls back to billing');
    assert(inv.businessDetails.gstin === '07AAAAA0000A1Z5', 'business details from settings');
    assert(inv.amountInWords === 'Rupees Seven Thousand Fifty Nine Only', 'amount in words saved');
    console.log(`✓ Test 5 Passed: ${inv.invoiceNumber} saved with recalculated totals`);

    console.log('[Test 6] Sequential numbering (including concurrent creates)...');
    const seq = Number(inv.invoiceNumber.slice(-4));
    const next = await request(server, { method: 'POST', path: '/api/invoices', headers: auth(admin), body: payload });
    assert(next.body.invoice.invoiceNumber === `NAVKA-202610-${String(seq + 1).padStart(4, '0')}`, 'next number is +1');
    const parallel = await Promise.all(
      [0, 1, 2].map(() => request(server, { method: 'POST', path: '/api/invoices', headers: auth(admin), body: payload }))
    );
    assert(parallel.every((r) => r.status === 201), `parallel creates all 201: ${parallel.map((r) => r.status)}`);
    const numbers = new Set(parallel.map((r) => r.body.invoice.invoiceNumber));
    assert(numbers.size === 3, 'parallel creates get distinct numbers');
    console.log('✓ Test 6 Passed: numbers are sequential and unique');

    console.log('[Test 7] PDF download for Admin and CA...');
    for (const user of [admin, ca]) {
      const pdf = await request(server, {
        method: 'GET',
        path: `/api/invoices/${inv._id}/pdf?download=1`,
        headers: auth(user),
      });
      assert(pdf.status === 200, `${user.role} PDF expected 200, got ${pdf.status}`);
      assert(pdf.headers['content-type'] === 'application/pdf', `content-type ${pdf.headers['content-type']}`);
      assert(
        String(pdf.headers['content-disposition']).startsWith(`attachment; filename="${inv.invoiceNumber}.pdf"`),
        `disposition ${pdf.headers['content-disposition']}`
      );
      assert(pdf.raw.subarray(0, 5).toString() === '%PDF-', 'body is a PDF');
      assert(pdf.raw.length > 1500, `PDF size ${pdf.raw.length}`);
    }

    // Seeded Shopify invoice, and a cancelled invoice (watermark path).
    const seeded = await Invoice.findOne({ invoiceNumber: 'NAVKA-2026-0001' });
    await Invoice.updateOne({ _id: inv._id }, { invoiceStatus: 'CANCELLED' });
    for (const id of [seeded!._id.toString(), inv._id]) {
      const pdf = await request(server, { method: 'GET', path: `/api/invoices/${id}/pdf`, headers: auth(ca) });
      assert(pdf.status === 200 && pdf.raw.subarray(0, 5).toString() === '%PDF-', `PDF for ${id}`);
      assert(String(pdf.headers['content-disposition']).startsWith('inline'), 'inline by default');
    }

    const many = await request(server, {
      method: 'POST',
      path: '/api/invoices',
      headers: auth(admin),
      body: {
        ...payload,
        items: Array.from({ length: 60 }, (_, i) => ({ ...payload.items[i % 2], productName: `Long item ${i + 1}` })),
      },
    });
    assert(many.status === 201, 'invoice with 60 lines created');
    const manyPdf = await request(server, { method: 'GET', path: `/api/invoices/${many.body.invoice._id}/pdf`, headers: auth(ca) });
    const pageCount = (manyPdf.raw.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    assert(manyPdf.status === 200 && pageCount >= 2, `multi-page PDF expected, got ${pageCount} page(s)`);

    const badPdf = await request(server, { method: 'GET', path: '/api/invoices/not-an-id/pdf', headers: auth(ca) });
    assert(badPdf.status === 400, `invalid id PDF expected 400, got ${badPdf.status}`);
    const noAuthPdf = await request(server, { method: 'GET', path: `/api/invoices/${inv._id}/pdf` });
    assert(noAuthPdf.status === 401, `unauthenticated PDF expected 401, got ${noAuthPdf.status}`);
    console.log(`✓ Test 7 Passed: PDFs stream for Admin & CA (multi-page: ${pageCount} pages), 400/401 guarded`);

    console.log('[Test 8] Read-only settings for Admin and CA...');
    const settings = await request(server, { method: 'GET', path: '/api/settings', headers: auth(ca) });
    assert(settings.status === 200 && settings.body.settings.gstin === '07AAAAA0000A1Z5', 'settings readable by CA');
    const caPut = await request(server, { method: 'PUT', path: '/api/settings', headers: auth(ca), body: {} });
    assert(caPut.status === 403, `CA settings write expected 403, got ${caPut.status}`);
    console.log('✓ Test 8 Passed: GET /api/settings for CA; PUT is Admin-only');
  } finally {
    server.close();
    await disconnectDB();
  }
}

(async () => {
  console.log('\n--- Starting Phase 7: Invoice Generation & PDF Engine Verification Tests ---\n');
  testCalculations();
  await testApi();
  console.log('\n======================================================');
  console.log(' ALL PHASE 7 INVOICE GENERATION & PDF TESTS PASSED!   ');
  console.log('======================================================\n');
})().catch((err) => {
  console.error('Invoice generation test failed:', err);
  process.exit(1);
});
