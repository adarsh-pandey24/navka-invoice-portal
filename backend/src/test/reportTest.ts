import ExcelJS from 'exceljs';
import { assert } from './assert';
import app from '../app';
import { connectDB, disconnectDB } from '../config/db';
import { seedAllData } from '../seed/seedData';
import { Invoice, Payment } from '../models';
import { manualInvoicePayload, near, request, seededTokens } from './http';

async function testReports() {
  console.log('\n--- Starting Phase 9: Sales Report & Export Verification Tests ---\n');
  await connectDB();
  await seedAllData();
  const { admin, ca } = await seededTokens();
  const server = app.listen(0);
  const get = (path: string, headers = ca) => request(server, { method: 'GET', path, headers });

  try {
    console.log('[Test 1] Summary KPIs match the database (CA)...');
    const res = await get('/api/reports/sales');
    assert(res.status === 200, `report 200, got ${res.status}`);
    const r = res.body;
    const invoices = await Invoice.find({ invoiceStatus: 'ACTIVE' });
    const sum = (pick: (i: (typeof invoices)[number]) => number) => invoices.reduce((s, i) => s + pick(i), 0);
    assert(r.summary.invoiceCount === invoices.length, `count ${r.summary.invoiceCount} vs ${invoices.length}`);
    assert(near(r.summary.grossSales, sum((i) => i.grandTotal)), 'gross sales');
    assert(near(r.summary.taxableAmount, sum((i) => i.taxableAmount)), 'taxable');
    assert(near(r.summary.totalGST, sum((i) => i.totalGST)), 'total GST');
    assert(near(r.summary.refunds, 7670), `refunds 7670, got ${r.summary.refunds}`);
    assert(near(r.summary.netSales, r.summary.grossSales - r.summary.refunds), 'net = gross - refunds');
    assert(near(r.summary.cgst + r.summary.sgst + r.summary.igst, r.summary.totalGST, 0.05), 'CGST+SGST+IGST = GST');
    const completed = await Payment.find({ paymentStatus: 'COMPLETED' });
    assert(near(r.summary.amountReceived, completed.reduce((s, p) => s + p.amount, 0)), 'amount received');
    assert(r.trend.reduce((s: number, t: any) => s + t.invoiceCount, 0) === invoices.length, 'trend covers all invoices');
    assert(near(r.hsnSummary.reduce((s: number, h: any) => s + h.taxableAmount, 0), r.summary.taxableAmount, 0.05), 'HSN taxable = total');
    assert(r.items.length === invoices.length && r.itemsTruncated === false, 'itemised rows');
    console.log(`✓ Test 1 Passed: gross ${r.summary.grossSales}, GST ${r.summary.totalGST}, net ${r.summary.netSales}`);

    console.log('[Test 2] Intra-state vs inter-state split per invoice...');
    const row = (n: string) => r.items.find((i: any) => i.invoiceNumber === n);
    const delhi = row('NAVKA-2026-0004'); // Delhi customer, Delhi business
    assert(delhi.igst === 0 && near(delhi.cgst + delhi.sgst, delhi.totalGST), 'Delhi -> CGST+SGST');
    const haryana = row('NAVKA-2026-0002'); // GSTIN 06 (Haryana)
    assert(haryana.cgst === 0 && near(haryana.igst, haryana.totalGST), 'Haryana -> IGST');
    assert(haryana.placeOfSupply === 'Haryana (06)', `place of supply, got ${haryana.placeOfSupply}`);
    assert(near(haryana.amountPaid, 10000) && near(haryana.balanceDue, haryana.grandTotal - 10000), 'partial balance');
    const refunded = row('NAVKA-2026-0003');
    assert(refunded.balanceDue === 0 && near(refunded.refundAmount, 7670), 'refunded row');
    console.log('✓ Test 2 Passed: CGST/SGST vs IGST and balances per invoice');

    console.log('[Test 3] Filters: HSN, payment status, customer, dates, cancelled...');
    const hsn = (await get('/api/reports/sales?hsnSac=844332')).body;
    assert(hsn.hsnSummary.length >= 1 && hsn.hsnSummary.every((h: any) => h.hsnSac.startsWith('844332')), 'HSN filter narrows table');
    assert(hsn.summary.invoiceCount >= 1 && hsn.summary.invoiceCount < invoices.length, 'HSN filter narrows invoices');
    const paid = (await get('/api/reports/sales?paymentStatus=PAID')).body;
    assert(paid.items.every((i: any) => i.paymentStatus === 'PAID') && paid.summary.invoiceCount === 2, 'PAID filter');
    const multi = (await get('/api/reports/sales?paymentStatus=PAID,PARTIAL')).body;
    assert(multi.summary.invoiceCount === 3, `PAID,PARTIAL = 3, got ${multi.summary.invoiceCount}`);
    const sharma = (await get('/api/reports/sales?customer=sharma')).body;
    assert(sharma.items.length >= 1 && sharma.items.every((i: any) => /sharma/i.test(i.customerName)), 'customer filter');
    const none = (await get('/api/reports/sales?startDate=2099-01-01&endDate=2099-12-31')).body;
    assert(none.summary.invoiceCount === 0 && none.summary.grossSales === 0 && none.items.length === 0, 'empty range zeros');
    const bad = await get('/api/reports/sales?startDate=garbage&paymentStatus=NOPE');
    assert(bad.status === 200 && bad.body.summary.invoiceCount === invoices.length, 'invalid filters ignored');

    const created = await request(server, { method: 'POST', path: '/api/invoices', headers: admin, body: manualInvoicePayload() });
    await request(server, { method: 'PUT', path: `/api/invoices/${created.body.invoice._id}`, headers: admin, body: { invoiceStatus: 'CANCELLED' } });
    const afterCancel = (await get('/api/reports/sales')).body;
    assert(afterCancel.summary.invoiceCount === invoices.length, 'cancelled invoice excluded by default');
    const cancelledOnly = (await get('/api/reports/sales?invoiceStatus=CANCELLED')).body;
    assert(cancelledOnly.summary.invoiceCount === 1, 'invoiceStatus=CANCELLED shows it');
    console.log('✓ Test 3 Passed: filters and cancelled-invoice handling');

    console.log('[Test 4] Exports: CSV, Excel, PDF...');
    const csv = await get('/api/reports/sales/export?format=csv');
    const csvText = csv.raw.toString('utf8').replace(/^﻿/, '');
    const lines = csvText.trim().split(/\r?\n/);
    assert(csv.status === 200 && lines[0].startsWith('Invoice Number,Invoice Date,Customer'), 'CSV header');
    assert(lines.length === invoices.length + 1, `CSV rows ${lines.length - 1} vs ${invoices.length}`);

    const xlsx = await get('/api/reports/sales/export?format=excel', admin);
    assert(xlsx.status === 200 && xlsx.raw.subarray(0, 2).toString() === 'PK', 'xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.raw as any);
    const names = wb.worksheets.map((w) => w.name);
    assert(['Summary', 'Invoices', 'HSN Summary', 'Daily Trend'].every((n) => names.includes(n)), `sheets: ${names}`);
    assert(wb.getWorksheet('Invoices')!.rowCount === invoices.length + 1, 'Invoices sheet rows');
    const grossCell = wb.getWorksheet('Summary')!.getRow(4).getCell(2).value;
    assert(near(Number(grossCell), r.summary.grossSales), `Excel gross sales ${grossCell}`);

    const pdf = await get('/api/reports/sales/export?format=pdf');
    assert(pdf.status === 200 && pdf.raw.subarray(0, 5).toString() === '%PDF-', 'PDF');
    const badFormat = await get('/api/reports/sales/export?format=doc');
    assert(badFormat.status === 400, 'bad export format 400');
    const unauth = await request(server, { method: 'GET', path: '/api/reports/sales' });
    assert(unauth.status === 401, 'report requires auth');
    console.log('✓ Test 4 Passed: CSV/Excel/PDF exports consistent with report');

    console.log('\n======================================================');
    console.log(' ALL PHASE 9 SALES REPORT & EXPORT TESTS PASSED!      ');
    console.log('======================================================\n');
  } finally {
    server.close();
    await disconnectDB();
  }
}

testReports().catch((err) => {
  console.error('Report test failed:', err);
  process.exit(1);
});
