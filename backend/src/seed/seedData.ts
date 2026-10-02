import { connectDB, disconnectDB } from '../config/db';
import { User, Product, Customer, Invoice, Payment, BusinessSettings } from '../models';
import { seedUsers } from './seedUsers';
import { convertAmountToWords } from '../utils/numberToWords';

export const seedAllData = async () => {
  console.log('[Seed] Starting complete database seeding for NAVKA...');

  // 1. Seed Users (Admin & CA)
  await seedUsers();
  const adminUser = await User.findOne({ role: 'ADMIN' });

  // 2. Seed Business Settings
  const settingsCount = await BusinessSettings.countDocuments();
  if (settingsCount === 0) {
    await BusinessSettings.create({
      businessName: 'NAVKA Enterprises Private Limited',
      address: 'Plot 42, Industrial Area Phase II, Okhla, New Delhi, Delhi 110020',
      gstin: '07AAAAA0000A1Z5',
      contactEmail: 'billing@navka.com',
      contactPhone: '+91 98765 43210',
      invoicePrefix: 'NAVKA',
      bankDetails: {
        bankName: 'HDFC Bank Ltd',
        accountNumber: '50200012345678',
        ifscCode: 'HDFC0000123',
        branch: 'Okhla Phase II, New Delhi',
      },
    });
    console.log('[Seed] Created default Business Settings.');
  }

  // 3. Seed Products
  await Product.deleteMany({});
  const products = await Product.create([
    {
      name: 'NAVKA High-Speed Thermal Receipt Printer',
      sku: 'NAV-PRN-01',
      hsnSac: '844332',
      unitPrice: 6500,
      gstRate: 18,
      shopifyProductId: 'shop_prod_001',
    },
    {
      name: 'NAVKA 2D Wireless Barcode Scanner',
      sku: 'NAV-SCN-02',
      hsnSac: '847160',
      unitPrice: 2800,
      gstRate: 18,
      shopifyProductId: 'shop_prod_002',
    },
    {
      name: 'NAVKA Heavy-Duty Electronic Cash Drawer',
      sku: 'NAV-CSH-03',
      hsnSac: '830300',
      unitPrice: 3200,
      gstRate: 18,
      shopifyProductId: 'shop_prod_003',
    },
    {
      name: 'NAVKA Enterprise Thermal Paper Rolls (Pack of 50)',
      sku: 'NAV-PPR-04',
      hsnSac: '481190',
      unitPrice: 1200,
      gstRate: 12,
      shopifyProductId: 'shop_prod_004',
    },
    {
      name: 'NAVKA POS Annual AMC & Cloud Maintenance Service',
      sku: 'NAV-AMC-05',
      hsnSac: '998313',
      unitPrice: 4500,
      gstRate: 18,
      shopifyProductId: 'shop_prod_005',
    },
  ]);
  console.log(`[Seed] Seeded ${products.length} Products.`);

  // 4. Seed Customers
  await Customer.deleteMany({});
  const customers = await Customer.create([
    {
      name: 'Sharma Retail Supermart',
      email: 'accounts@sharmaretail.in',
      phone: '+91 98111 22334',
      gstin: '07AAACS1429B1Z8',
      billingAddress: {
        street: 'Shop 14-16, Main Market, Lajpat Nagar II',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110024',
        country: 'India',
      },
      shippingAddress: {
        street: 'Shop 14-16, Main Market, Lajpat Nagar II',
        city: 'New Delhi',
        state: 'Delhi',
        pincode: '110024',
        country: 'India',
      },
      shopifyCustomerId: 'cust_shop_01',
    },
    {
      name: 'Apex Healthcare Pharmacy & Diagnostics',
      email: 'procurement@apexhealth.co',
      phone: '+91 99222 33445',
      gstin: '06AACCA5543C1Z2',
      billingAddress: {
        street: 'Sector 14 Commercial Complex',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122001',
        country: 'India',
      },
      shippingAddress: {
        street: 'Sector 14 Commercial Complex',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122001',
        country: 'India',
      },
      shopifyCustomerId: 'cust_shop_02',
    },
    {
      name: 'Amitabh Verma',
      email: 'amitabh.verma@gmail.com',
      phone: '+91 97333 44556',
      billingAddress: {
        street: 'Flat 402, Royal Palms, Goregaon East',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400063',
        country: 'India',
      },
      shippingAddress: {
        street: 'Flat 402, Royal Palms, Goregaon East',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400063',
        country: 'India',
      },
      shopifyCustomerId: 'cust_shop_03',
    },
  ]);
  console.log(`[Seed] Seeded ${customers.length} Customers.`);

  // 5. Seed Invoices & Payments
  await Invoice.deleteMany({});
  await Payment.deleteMany({});

  const business = {
    name: 'NAVKA Enterprises Private Limited',
    address: 'Plot 42, Industrial Area Phase II, Okhla, New Delhi, Delhi 110020',
    gstin: '07AAAAA0000A1Z5',
    phone: '+91 98765 43210',
    email: 'billing@navka.com',
  };

  // Helper to calculate invoice items & totals
  const buildInvoice = (data: {
    invoiceNumber: string;
    date: Date;
    shopifyOrderId?: string;
    shopifyOrderNumber?: string;
    customer: any;
    rawItems: { product: any; quantity: number; discount: number }[];
    paymentStatus: 'PAID' | 'PENDING' | 'PARTIAL' | 'FAILED' | 'REFUNDED';
    source: 'SHOPIFY' | 'MANUAL';
    refundDetails?: any;
    notes?: string;
  }) => {
    let subtotal = 0;
    let totalDiscount = 0;
    let taxableAmount = 0;
    let totalGST = 0;

    const items = data.rawItems.map((entry) => {
      const lineSubtotal = entry.product.unitPrice * entry.quantity;
      const lineDiscount = (lineSubtotal * entry.discount) / 100;
      const lineTaxable = lineSubtotal - lineDiscount;
      const lineGst = (lineTaxable * entry.product.gstRate) / 100;
      const lineTotal = lineTaxable + lineGst;

      subtotal += lineSubtotal;
      totalDiscount += lineDiscount;
      taxableAmount += lineTaxable;
      totalGST += lineGst;

      return {
        productId: entry.product._id,
        productName: entry.product.name,
        hsnSac: entry.product.hsnSac,
        quantity: entry.quantity,
        unitPrice: entry.product.unitPrice,
        discount: Math.round(lineDiscount * 100) / 100, // stored as rupee AMOUNT (entry.discount is the % input)
        taxableAmount: Math.round(lineTaxable * 100) / 100,
        gstRate: entry.product.gstRate,
        gstAmount: Math.round(lineGst * 100) / 100,
        totalAmount: Math.round(lineTotal * 100) / 100,
      };
    });

    const unroundedTotal = taxableAmount + totalGST;
    const grandTotal = Math.round(unroundedTotal);
    const roundOff = Math.round((grandTotal - unroundedTotal) * 100) / 100;

    return {
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.date,
      shopifyOrderId: data.shopifyOrderId,
      shopifyOrderNumber: data.shopifyOrderNumber,
      customer: {
        customerId: data.customer._id,
        name: data.customer.name,
        email: data.customer.email,
        phone: data.customer.phone,
        gstin: data.customer.gstin,
        billingAddress: data.customer.billingAddress,
        shippingAddress: data.customer.shippingAddress,
      },
      businessDetails: business,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      discount: Math.round(totalDiscount * 100) / 100,
      taxableAmount: Math.round(taxableAmount * 100) / 100,
      totalGST: Math.round(totalGST * 100) / 100,
      grandTotal,
      roundOff,
      amountInWords: convertAmountToWords(grandTotal),
      paymentStatus: data.paymentStatus,
      invoiceStatus: 'ACTIVE' as const,
      source: data.source,
      refundDetails: data.refundDetails,
      notes: data.notes,
    };
  };

  // Create 5 sample invoices representing diverse scenarios
  const now = new Date();

  // Invoice 1: Shopify Online Paid
  const invData1 = buildInvoice({
    invoiceNumber: 'NAVKA-2026-0001',
    date: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    shopifyOrderId: 'shop_order_1001',
    shopifyOrderNumber: '#1001',
    customer: customers[0],
    rawItems: [
      { product: products[0], quantity: 2, discount: 5 }, // Thermal printer
      { product: products[3], quantity: 4, discount: 0 }, // Paper rolls
    ],
    paymentStatus: 'PAID',
    source: 'SHOPIFY',
  });
  const inv1 = await Invoice.create(invData1);
  await Payment.create({
    invoiceId: inv1._id,
    orderId: '#1001',
    amount: inv1.grandTotal,
    paymentDate: inv1.invoiceDate,
    paymentMethod: 'ONLINE',
    paymentSource: 'ONLINE',
    paymentStatus: 'COMPLETED',
    referenceId: 'shp_pay_razorpay_9938120',
    notes: 'Paid via Shopify Razorpay Integration',
  });

  // Invoice 2: Shopify Partially Paid Offline
  const invData2 = buildInvoice({
    invoiceNumber: 'NAVKA-2026-0002',
    date: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    shopifyOrderId: 'shop_order_1002',
    shopifyOrderNumber: '#1002',
    customer: customers[1],
    rawItems: [
      { product: products[1], quantity: 3, discount: 10 }, // Barcode scanners
      { product: products[2], quantity: 2, discount: 5 }, // Cash drawers
    ],
    paymentStatus: 'PARTIAL',
    source: 'SHOPIFY',
  });
  const inv2 = await Invoice.create(invData2);
  await Payment.create({
    invoiceId: inv2._id,
    orderId: '#1002',
    amount: 10000,
    paymentDate: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    paymentMethod: 'BANK_TRANSFER',
    paymentSource: 'OFFLINE',
    paymentStatus: 'COMPLETED',
    referenceId: 'NEFT-HDFC-99881122',
    notes: 'Partial advance payment received via NEFT',
    recordedBy: adminUser?._id,
  });

  // Invoice 3: Shopify Refunded
  const invData3 = buildInvoice({
    invoiceNumber: 'NAVKA-2026-0003',
    date: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
    shopifyOrderId: 'shop_order_1003',
    shopifyOrderNumber: '#1003',
    customer: customers[2],
    rawItems: [{ product: products[0], quantity: 1, discount: 0 }],
    paymentStatus: 'REFUNDED',
    source: 'SHOPIFY',
    refundDetails: {
      isRefunded: true,
      refundAmount: 7670,
      refundDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      refundReason: 'Customer requested return - product incompatible',
    },
  });
  const inv3 = await Invoice.create(invData3);
  await Payment.create({
    invoiceId: inv3._id,
    orderId: '#1003',
    amount: inv3.grandTotal,
    paymentDate: inv3.invoiceDate,
    paymentMethod: 'ONLINE',
    paymentSource: 'ONLINE',
    paymentStatus: 'REFUNDED',
    referenceId: 'shp_pay_refund_883391',
    notes: 'Online payment fully refunded to source',
  });

  // Invoice 4: Shopify Pending Payment
  const invData4 = buildInvoice({
    invoiceNumber: 'NAVKA-2026-0004',
    date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
    shopifyOrderId: 'shop_order_1004',
    shopifyOrderNumber: '#1004',
    customer: customers[0],
    rawItems: [{ product: products[4], quantity: 2, discount: 0 }], // AMC
    paymentStatus: 'PENDING',
    source: 'SHOPIFY',
  });
  await Invoice.create(invData4);

  // Invoice 5: Manual B2B In-house Invoice Paid via Cheque
  const invData5 = buildInvoice({
    invoiceNumber: 'NAVKA-2026-0005',
    date: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
    customer: customers[1],
    rawItems: [
      { product: products[0], quantity: 5, discount: 12 },
      { product: products[1], quantity: 5, discount: 10 },
      { product: products[4], quantity: 1, discount: 15 },
    ],
    paymentStatus: 'PAID',
    source: 'MANUAL',
    notes: 'Corporate bulk order issued with 12% institutional discount',
  });
  const inv5 = await Invoice.create(invData5);
  await Payment.create({
    invoiceId: inv5._id,
    orderId: inv5.invoiceNumber,
    amount: inv5.grandTotal,
    paymentDate: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
    paymentMethod: 'CHEQUE',
    paymentSource: 'OFFLINE',
    paymentStatus: 'COMPLETED',
    referenceId: 'CHQ-882910-ICICI',
    notes: 'Full payment received by Cheque No 882910, cleared successfully',
    recordedBy: adminUser?._id,
  });

  const totalInvoices = await Invoice.countDocuments();
  const totalPayments = await Payment.countDocuments();
  console.log(`[Seed] Seeded ${totalInvoices} Invoices and ${totalPayments} Payment transactions.`);
  console.log('[Seed] Database initialization completed successfully.');
};

// Direct script execution
if (require.main === module) {
  // seedAllData deletes all products, customers, invoices and payments and resets
  // the demo user passwords. Refuse to run it against production by accident.
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force-production')) {
    console.error('[Seed] Refusing to seed: NODE_ENV=production. This deletes all invoices and payments.');
    console.error('[Seed] Re-run with --force-production only on an empty, new database.');
    process.exit(1);
  }
  (async () => {
    try {
      await connectDB();
      await seedAllData();
      await disconnectDB();
      process.exit(0);
    } catch (err: any) {
      console.error('[Seed] Failure during seeding:', err);
      process.exit(1);
    }
  })();
}
