import ExcelJS from 'exceljs';
import { assert } from './assert';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import { bearer, near, request } from './http';

// Phase 10: full user journey over HTTP, starting from the real login endpoint.
async function testEndToEnd() {
  console.log('\n--- Starting Phase 10: End-to-End User Journey ---\n');
  await connectDB();
  await seedAllData();
  const server = app.listen(0);
  const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
    request(server, { method, path, headers, body });

  try {
    console.log('[Step 1] Admin and CA log in...');
    const adminLogin = await call('POST', '/api/auth/login', {}, { email: 'admin@navka.com', password: 'admin123' });
    const caLogin = await call('POST', '/api/auth/login', {}, { email: 'CA@navka.com ', password: 'ca123' });
    assert(adminLogin.status === 200 && adminLogin.body.user.role === 'ADMIN', 'admin login');
    assert(caLogin.status === 200 && caLogin.body.user.role === 'CA', 'CA login (email normalised)');
    const badLogin = await call('POST', '/api/auth/login', {}, { email: 'admin@navka.com', password: 'wrong' });
    assert(badLogin.status === 401, 'wrong password 401');
    const admin = bearer(adminLogin.body.token);
    const ca = bearer(caLogin.body.token);
    const me = await call('GET', '/api/auth/me', ca);
    assert(me.body.user.role === 'CA', 'session role');
    console.log('✓ Step 1: logins issue role-scoped JWTs');

    const before = (await call('GET', '/api/dashboard', admin)).body.summary;
    const reportBefore = (await call('GET', '/api/reports/sales', admin)).body.summary;

    console.log('[Step 2] Admin creates an inter-state B2B invoice...');
    const created = await call('POST', '/api/invoices', admin, {
      customer: {
        name: 'Journey Retail LLP',
        gstin: '29AAJFJ1234K1Z3',
        billingAddress: { street: '12 Brigade Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
      },
      items: [
        { productName: 'POS Terminal', hsnSac: '847050', quantity: 2, unitPrice: 12500, discount: 10, gstRate: 18 },
        { productName: 'Installation Service', hsnSac: '998713', quantity: 1, unitPrice: 1500, discount: 0, gstRate: 18 },
      ],
      notes: 'E2E journey',
    });
    assert(created.status === 201, `create 201, got ${created.status}: ${created.body?.message}`);
    const inv = created.body.invoice;
    // 2*12500 = 25000 - 10% = 22500; +1500 = 24000 taxable; GST 4320; total 28320
    assert(inv.taxableAmount === 24000 && inv.totalGST === 4320 && inv.grandTotal === 28320, 'invoice maths');
    assert(inv.amountInWords === 'Rupees Twenty Eight Thousand Three Hundred Twenty Only', inv.amountInWords);
    console.log(`✓ Step 2: ${inv.invoiceNumber} = ₹28,320`);

    console.log('[Step 3] CA finds and views it, downloads the PDF, cannot pay it...');
    const found = await call('GET', `/api/invoices?search=${encodeURIComponent('Journey Retail')}`, ca);
    assert(found.body.invoices.length === 1 && found.body.invoices[0]._id === inv._id, 'search finds invoice');
    const detail = await call('GET', `/api/invoices/${inv._id}`, ca);
    assert(detail.body.summary.balanceDue === 28320, 'balance = total');
    const pdf = await call('GET', `/api/invoices/${inv._id}/pdf`, ca);
    assert(pdf.status === 200 && pdf.raw.subarray(0, 5).toString() === '%PDF-', 'CA PDF');
    const caPay = await call('POST', '/api/payments', ca, { invoiceId: inv._id, amount: 100, paymentMethod: 'CASH' });
    assert(caPay.status === 403, 'CA cannot pay');
    console.log('✓ Step 3: CA view/download only');

    console.log('[Step 4] Dashboard and report pick up the new invoice...');
    const after = (await call('GET', '/api/dashboard', admin)).body.summary;
    assert(after.totalInvoices === before.totalInvoices + 1, 'dashboard invoice count +1');
    assert(near(after.totalSales, before.totalSales + 28320), 'dashboard sales +28320');
    assert(near(after.pendingPayments, before.pendingPayments + 28320), 'dashboard pending +28320');
    const report = (await call('GET', '/api/reports/sales', ca)).body;
    assert(report.summary.invoiceCount === reportBefore.invoiceCount + 1, 'report count +1');
    assert(near(report.summary.igst, reportBefore.igst + 4320), 'Karnataka invoice adds IGST');
    const row = report.items.find((r: any) => r._id === inv._id);
    assert(row && row.igst === 4320 && row.cgst === 0 && row.placeOfSupply === 'Karnataka (29)', 'report row IGST');
    console.log('✓ Step 4: dashboard + report updated (IGST for Karnataka)');

    console.log('[Step 5] Admin records cheque part-payment, then NEFT balance...');
    const part = await call('POST', '/api/payments', admin, {
      invoiceId: inv._id,
      amount: 10000,
      paymentMethod: 'CHEQUE',
      referenceId: 'CHQ-004512',
    });
    assert(part.status === 201 && part.body.updatedInvoiceStatus === 'PARTIAL', 'PARTIAL');
    const mid = (await call('GET', '/api/dashboard', admin)).body.summary;
    assert(near(mid.pendingPayments, before.pendingPayments + 18320), 'dashboard pending reflects partial');
    const rest = await call('POST', '/api/payments', admin, {
      invoiceId: inv._id,
      amount: 18320,
      paymentMethod: 'BANK_TRANSFER',
      referenceId: 'UTR-NEFT-99812',
    });
    assert(rest.status === 201 && rest.body.updatedInvoiceStatus === 'PAID' && rest.body.balanceDue === 0, 'PAID');
    console.log('✓ Step 5: PENDING -> PARTIAL -> PAID');

    console.log('[Step 6] Ledger, report and exports agree...');
    const ledger = (await call('GET', `/api/payments?invoiceId=${inv._id}`, ca)).body;
    assert(ledger.pagination.totalRecords === 2 && near(ledger.summary.offlineReceived, 28320), 'ledger shows both');
    const paidReport = (await call('GET', '/api/reports/sales?paymentStatus=PAID&customer=Journey', ca)).body;
    assert(paidReport.items.length === 1 && paidReport.items[0].amountPaid === 28320 && paidReport.items[0].balanceDue === 0, 'report paid row');
    const xlsx = await call('GET', '/api/reports/sales/export?format=excel&customer=Journey', ca);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.raw as any);
    const sheet = wb.getWorksheet('Invoices')!;
    assert(sheet.getRow(2).getCell(1).value === inv.invoiceNumber, 'Excel register row');
    const csv = (await call('GET', `/api/payments/export?format=csv&invoiceId=${inv._id}`, ca)).raw.toString('utf8');
    assert(csv.includes('CHQ-004512') && csv.includes('UTR-NEFT-99812'), 'payment CSV references');
    console.log('✓ Step 6: ledger, report, Excel and CSV consistent');

    console.log('[Step 7] Paid invoice rejects more payments; CA still read-only on settings...');
    const extra = await call('POST', '/api/payments', admin, { invoiceId: inv._id, amount: 1, paymentMethod: 'CASH' });
    assert(extra.status === 400, 'fully paid 400');
    const caSettings = await call('PUT', '/api/settings', ca, { businessName: 'Hacked' });
    assert(caSettings.status === 403, 'CA settings 403');
    console.log('✓ Step 7: guards hold');

    console.log('\n======================================================');
    console.log(' ALL PHASE 10 END-TO-END JOURNEY TESTS PASSED!        ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

testEndToEnd().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
