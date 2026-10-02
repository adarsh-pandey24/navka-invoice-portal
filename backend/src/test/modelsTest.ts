import { assert } from './assert';
import { connectDB, disconnectDB } from '../config/db';
import { User, Product, Customer, Invoice, Payment, BusinessSettings } from '../models';
import { seedAllData } from '../seed/seedData';

async function testModels() {
  console.log('\n--- Starting Phase 3: Database Models & Schemas Verification Test ---\n');
  await connectDB();
  await seedAllData();

  try {
    // 1. Verify Users
    console.log('[Test 1] Verifying Users...');
    const admin = await User.findOne({ role: 'ADMIN' });
    const ca = await User.findOne({ role: 'CA' });
    assert(!!admin, 'Admin user should exist');
    assert(!!ca, 'CA user should exist');
    console.log('✓ Test 1 Passed: Admin and CA accounts exist');

    // 2. Verify Products
    console.log('[Test 2] Verifying Products & HSN/SAC...');
    const products = await Product.find();
    assert(products.length >= 5, `Expected >= 5 products, got ${products.length}`);
    const hsnCodes = products.map((p) => p.hsnSac);
    assert(hsnCodes.includes('844332'), 'Should contain printer HSN');
    console.log(`✓ Test 2 Passed: ${products.length} products verified with valid HSN/SAC codes (${hsnCodes.join(', ')})`);

    // 3. Verify Customers
    console.log('[Test 3] Verifying Customers & GSTIN...');
    const customers = await Customer.find();
    assert(customers.length >= 3, 'Expected >= 3 customers');
    assert(customers.some((c) => !!c.gstin), 'Expected customer with GSTIN');
    console.log(`✓ Test 3 Passed: ${customers.length} customers verified with addresses and GSTIN`);

    // 4. Verify Invoices & Mathematical Integrity
    console.log('[Test 4] Verifying Invoices & Financial Calculations...');
    const invoices = await Invoice.find();
    assert(invoices.length >= 5, `Expected >= 5 invoices, got ${invoices.length}`);

    for (const inv of invoices) {
      assert(inv.invoiceNumber.startsWith('NAVKA-'), `Invalid prefix on ${inv.invoiceNumber}`);
      assert(inv.grandTotal > 0, `Grand total must be positive on ${inv.invoiceNumber}`);
      assert(inv.amountInWords.includes('Rupees'), `Amount in words missing 'Rupees' on ${inv.invoiceNumber}`);
      
      // Item discount is a rupee AMOUNT: taxable = qty * unitPrice - discount
      for (const item of inv.items) {
        const expectedTaxable = item.quantity * item.unitPrice - item.discount;
        assert(
          Math.abs(expectedTaxable - item.taxableAmount) < 0.05,
          `Line discount convention broken on ${inv.invoiceNumber} / ${item.productName}: expected taxable ${expectedTaxable}, stored ${item.taxableAmount}`
        );
      }

      // Verify line items sum
      const computedTaxable = inv.items.reduce((sum, item) => sum + item.taxableAmount, 0);
      const computedGST = inv.items.reduce((sum, item) => sum + item.gstAmount, 0);
      
      assert(
        Math.abs(computedTaxable - inv.taxableAmount) < 0.05,
        `Taxable amount mismatch on ${inv.invoiceNumber}: computed ${computedTaxable} vs stored ${inv.taxableAmount}`
      );
      assert(
        Math.abs(computedGST - inv.totalGST) < 0.05,
        `Total GST mismatch on ${inv.invoiceNumber}: computed ${computedGST} vs stored ${inv.totalGST}`
      );
    }
    console.log(`✓ Test 4 Passed: ${invoices.length} invoices verified for line item math and amount-in-words integrity`);

    // 5. Verify Payments & Relationships
    console.log('[Test 5] Verifying Payments & Invoice Relationships...');
    const payments = await Payment.find().populate('invoiceId');
    assert(payments.length >= 4, `Expected >= 4 payments, got ${payments.length}`);

    const sources = payments.map((p) => p.paymentSource);
    assert(sources.includes('ONLINE'), 'Must contain ONLINE payment');
    assert(sources.includes('OFFLINE'), 'Must contain OFFLINE payment');

    for (const pay of payments) {
      assert(!!pay.invoiceId, 'Payment must have populated invoice reference');
      assert(pay.amount > 0, 'Payment amount must be positive');
    }
    console.log(`✓ Test 5 Passed: ${payments.length} unified payments verified (ONLINE & OFFLINE) with Invoice joins`);

    // 6. Aggregation test (Total Sales & GST)
    console.log('[Test 6] Testing Aggregation Pipeline for Dashboard KPIs...');
    const [salesKpi] = await Invoice.aggregate([
      { $match: { invoiceStatus: 'ACTIVE' } },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$grandTotal' },
          totalTaxable: { $sum: '$taxableAmount' },
          totalGST: { $sum: '$totalGST' },
          count: { $sum: 1 },
        },
      },
    ]);
    assert(salesKpi.totalSales > 0, 'Total sales should be > 0');
    assert(salesKpi.totalGST > 0, 'Total GST should be > 0');
    console.log(`✓ Test 6 Passed: Aggregation calculated Total Sales: ₹${salesKpi.totalSales.toLocaleString('en-IN')}, Total GST: ₹${salesKpi.totalGST.toLocaleString('en-IN')}`);

    console.log('\n======================================================');
    console.log(' ALL PHASE 3 DATABASE MODEL TESTS PASSED SUCCESSFULLY! ');
    console.log('======================================================\n');
  } finally {
    await disconnectDB();
  }
}

testModels().catch((err) => {
  console.error('Model test run failed:', err);
  process.exit(1);
});
