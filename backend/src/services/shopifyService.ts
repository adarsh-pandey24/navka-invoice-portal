import axios from 'axios';
import { AppError } from '../middleware/errorMiddleware';
import { ENV } from '../config/env';
import { Invoice, Payment, Customer, Product, BusinessSettings } from '../models';
import { convertAmountToWords } from '../utils/numberToWords';
import { reconcileInvoicePaymentStatus } from './paymentService';

export interface ShopifyTaxLine {
  title: string;
  price: string;
  rate: number;
}

export interface ShopifyShippingLine {
  title: string;
  price: string;
  discounted_price?: string;
  tax_lines?: ShopifyTaxLine[];
}

export interface ShopifyLineItem {
  id: number;
  product_id?: number | null;
  title: string;
  quantity: number;
  price: string;
  total_discount: string;
  sku?: string;
  tax_lines?: Array<{
    title: string;
    price: string;
    rate: number;
  }>;
}

export interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  address1?: string;
  city?: string;
  province?: string;
  zip?: string;
  country?: string;
  phone?: string;
}

export interface ShopifyCustomer {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  default_address?: ShopifyAddress;
}

export interface ShopifyRefund {
  id: number;
  created_at: string;
  note?: string;
  transactions?: Array<{
    amount: string;
    status: string;
    kind?: string;
  }>;
}

export interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  created_at: string;
  cancelled_at?: string | null;
  taxes_included?: boolean;
  total_price?: string;
  shipping_lines?: ShopifyShippingLine[];
  financial_status: 'paid' | 'pending' | 'authorized' | 'partially_paid' | 'refunded' | 'partially_refunded' | 'voided';
  current_subtotal_price: string;
  total_tax: string;
  current_total_price: string;
  total_discounts: string;
  payment_gateway_names?: string[];
  customer?: ShopifyCustomer;
  billing_address?: ShopifyAddress;
  shipping_address?: ShopifyAddress;
  line_items: ShopifyLineItem[];
  refunds?: ShopifyRefund[];
  note?: string;
}

// Generate realistic mock Shopify orders when running with demo token or offline
export const generateMockShopifyOrders = (): ShopifyOrder[] => {
  const now = new Date();
  return [
    {
      id: 900101,
      order_number: 1050,
      name: '#1050',
      created_at: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      financial_status: 'paid',
      current_subtotal_price: '6500.00',
      total_tax: '1170.00',
      current_total_price: '7670.00',
      total_discounts: '0.00',
      payment_gateway_names: ['Shopify Payments (Razorpay)'],
      customer: {
        id: 701,
        first_name: 'Rajesh',
        last_name: 'Khanna',
        email: 'rajesh.khanna@textiles.in',
        phone: '+91 98991 22334',
      },
      billing_address: {
        first_name: 'Rajesh',
        last_name: 'Khanna',
        address1: 'Plot 15, Sector 18',
        city: 'Noida',
        province: 'Uttar Pradesh',
        zip: '201301',
        country: 'India',
        phone: '+91 98991 22334',
      },
      shipping_address: {
        first_name: 'Rajesh',
        last_name: 'Khanna',
        address1: 'Plot 15, Sector 18',
        city: 'Noida',
        province: 'Uttar Pradesh',
        zip: '201301',
        country: 'India',
        phone: '+91 98991 22334',
      },
      line_items: [
        {
          id: 501,
          title: 'NAVKA High-Speed Thermal Receipt Printer',
          quantity: 1,
          price: '6500.00',
          total_discount: '0.00',
          sku: 'NAV-PRN-01',
          tax_lines: [
            {
              title: 'GST 18%',
              price: '1170.00',
              rate: 0.18,
            },
          ],
        },
      ],
    },
    {
      id: 900102,
      order_number: 1051,
      name: '#1051',
      created_at: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      financial_status: 'refunded',
      current_subtotal_price: '2800.00',
      total_tax: '504.00',
      current_total_price: '3304.00',
      total_discounts: '0.00',
      payment_gateway_names: ['UPI / Netbanking'],
      customer: {
        id: 702,
        first_name: 'Sunita',
        last_name: 'Patel',
        email: 'sunita.patel@retailhub.com',
        phone: '+91 98771 99887',
      },
      billing_address: {
        first_name: 'Sunita',
        last_name: 'Patel',
        address1: '202 Trade Tower, Ring Road',
        city: 'Surat',
        province: 'Gujarat',
        zip: '395002',
        country: 'India',
      },
      line_items: [
        {
          id: 502,
          title: 'NAVKA 2D Wireless Barcode Scanner',
          quantity: 1,
          price: '2800.00',
          total_discount: '0.00',
          sku: 'NAV-SCN-02',
          tax_lines: [
            {
              title: 'GST 18%',
              price: '504.00',
              rate: 0.18,
            },
          ],
        },
      ],
      refunds: [
        {
          id: 881,
          created_at: new Date().toISOString(),
          note: 'Customer ordered wrong model, return approved',
          transactions: [{ amount: '3304.00', status: 'success' }],
        },
      ],
    },
    {
      id: 900103,
      order_number: 1052,
      name: '#1052',
      created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      financial_status: 'pending',
      current_subtotal_price: '5600.00',
      total_tax: '784.00',
      current_total_price: '6384.00',
      total_discounts: '200.00',
      payment_gateway_names: ['Cash on Delivery / Pending Offline'],
      customer: {
        id: 703,
        first_name: 'Karan',
        last_name: 'Mehta',
        email: 'karan.mehta@quickmart.in',
        phone: '+91 98220 11443',
      },
      billing_address: {
        first_name: 'Karan',
        last_name: 'Mehta',
        address1: 'Shop 5, Commercial Complex',
        city: 'Pune',
        province: 'Maharashtra',
        zip: '411001',
        country: 'India',
      },
      line_items: [
        {
          id: 503,
          title: 'NAVKA 2D Wireless Barcode Scanner',
          quantity: 2,
          price: '2800.00',
          total_discount: '200.00',
          sku: 'NAV-SCN-02',
          tax_lines: [
            {
              title: 'GST 18%',
              price: '784.00',
              rate: 0.18,
            },
          ],
        },
      ],
    },
  ];
};

export interface SyncOptions {
  sinceId?: string;
  createdAtMin?: string;
}

export interface SyncResult {
  count: number;
  failed: Array<{ order: string; error: string }>;
  orders: any[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// HSN/SAC for Shopify shipping charges (courier / transport services)
const SHIPPING_SAC = '996812';

export class ShopifyService {
  /** True when the configured token is a placeholder (demo/mock data mode). */
  public static isDemoMode(): boolean {
    const t = ENV.SHOPIFY_ACCESS_TOKEN;
    return !t || t.includes('demo') || t.includes('mock');
  }

  private static baseUrl(): string {
    return ENV.SHOPIFY_BASE_URL || `https://${ENV.SHOPIFY_STORE_DOMAIN}`;
  }

  /** GET with rate-limit (429) and transient-failure (5xx / network) retries. */
  private static async getWithRetry(url: string): Promise<{ data: any; headers: any }> {
    let lastError: any;
    for (let attempt = 0; attempt <= ENV.SHOPIFY_MAX_RETRIES; attempt++) {
      try {
        const res = await axios.get(url, {
          headers: { 'X-Shopify-Access-Token': ENV.SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' },
          timeout: 15000,
        });
        return { data: res.data, headers: res.headers };
      } catch (error: any) {
        lastError = error;
        const status: number | undefined = error.response?.status;

        if (status === 401 || status === 403) {
          throw new AppError('Shopify rejected the credentials (check SHOPIFY_ACCESS_TOKEN and app scopes: read_orders).', 502);
        }
        if (status === 404) {
          throw new AppError('Shopify store or API version not found (check SHOPIFY_STORE_DOMAIN / SHOPIFY_API_VERSION).', 502);
        }

        const retryable = status === 429 || (status !== undefined && status >= 500) || status === undefined;
        if (!retryable || attempt === ENV.SHOPIFY_MAX_RETRIES) break;

        const retryAfter = num(error.response?.headers?.['retry-after']);
        const waitMs =
          status === 429 && error.response?.headers?.['retry-after'] !== undefined
            ? Math.min(retryAfter * 1000, 10000)
            : ENV.SHOPIFY_RETRY_BASE_MS * Math.pow(2, attempt);
        console.warn(`[ShopifyService] ${status ?? error.code ?? 'network error'} - retry ${attempt + 1}/${ENV.SHOPIFY_MAX_RETRIES} in ${waitMs}ms`);
        await sleep(waitMs);
      }
    }
    const detail = lastError?.response?.status ? `HTTP ${lastError.response.status}` : lastError?.code || lastError?.message;
    throw new AppError(`Shopify request failed after retries (${detail}).`, 502);
  }

  /** Extracts the rel="next" URL from Shopify's cursor-pagination Link header. */
  private static nextPageUrl(linkHeader?: string): string | null {
    if (!linkHeader) return null;
    for (const part of linkHeader.split(',')) {
      const m = part.match(/<([^>]+)>;\s*rel="next"/);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * Fetches ALL matching orders from the Shopify Admin API (cursor pagination).
   * Demo mode (placeholder token) returns mock orders. A live-API failure now
   * raises an error instead of silently importing mock data into the database.
   */
  public static async fetchOrders(options: SyncOptions = {}): Promise<ShopifyOrder[]> {
    if (this.isDemoMode()) {
      if (ENV.NODE_ENV === 'production') {
        throw new AppError('Shopify is not configured: set a real SHOPIFY_ACCESS_TOKEN.', 503);
      }
      console.log('[ShopifyService] Using realistic mock Shopify orders (Demo Mode).');
      return generateMockShopifyOrders();
    }

    const params = new URLSearchParams({ status: 'any', limit: '250' });
    if (options.sinceId) params.set('since_id', options.sinceId);
    if (options.createdAtMin) params.set('created_at_min', options.createdAtMin);

    let url: string | null = `${this.baseUrl()}/admin/api/${ENV.SHOPIFY_API_VERSION}/orders.json?${params.toString()}`;
    const orders: ShopifyOrder[] = [];
    let pages = 0;

    while (url && pages < 200) {
      console.log(`[ShopifyService] Fetching orders page ${pages + 1}`);
      const { data, headers } = await this.getWithRetry(url);
      orders.push(...(data?.orders || []));
      url = this.nextPageUrl(headers?.link);
      pages++;
    }
    return orders;
  }

  /** Shared line maths for product lines and shipping lines. */
  private static computeLine(
    unitGross: number,
    qty: number,
    discountGross: number,
    taxLines: ShopifyTaxLine[] | undefined,
    taxesIncluded: boolean
  ) {
    const gstFromShopify = round2((taxLines || []).reduce((s, t) => s + num(t.price), 0));
    const rate = round2((taxLines || []).reduce((s, t) => s + (t.rate || 0), 0) * 100);
    const factor = taxesIncluded ? 1 + rate / 100 : 1;

    // Convert tax-inclusive Shopify prices to ex-tax so the invoice maths matches manual invoices.
    const unitPrice = round2(unitGross / factor);
    const discount = round2(discountGross / factor);
    const taxable = round2(unitPrice * qty - discount);
    const gstAmount = gstFromShopify; // Shopify's own tax is authoritative
    return { unitPrice, discount, taxable, gstRate: rate, gstAmount, total: round2(taxable + gstAmount) };
  }

  /** Resolve a local Product (for HSN/SAC) by Shopify product id, then SKU. */
  private static async findHsn(item: ShopifyLineItem): Promise<string> {
    if (item.product_id) {
      const byId = await Product.findOne({ shopifyProductId: String(item.product_id) });
      if (byId?.hsnSac) return byId.hsnSac;
    }
    if (item.sku) {
      const bySku = await Product.findOne({ sku: item.sku });
      if (bySku?.hsnSac) return bySku.hsnSac;
    }
    return ENV.SHOPIFY_DEFAULT_HSN;
  }

  /** Finds or creates the Customer; guests are never merged into unrelated customers. */
  private static async resolveCustomer(order: ShopifyOrder, name: string, email: string, phone: string, billing: any, shipping: any) {
    const shopifyOrderId = order.id.toString();
    const shopifyCustomerId = order.customer?.id?.toString();

    // Re-syncs keep the customer already linked to this order's invoice
    const existingInvoice = await Invoice.findOne({ shopifyOrderId }).select('customer.customerId');
    if (existingInvoice?.customer?.customerId) {
      const linked = await Customer.findById(existingInvoice.customer.customerId);
      if (linked) return linked;
    }

    const or: any[] = [];
    if (shopifyCustomerId) or.push({ shopifyCustomerId });
    if (email) or.push({ email });
    let doc = or.length ? await Customer.findOne({ $or: or }) : null;

    if (!doc) {
      doc = await Customer.create({
        name,
        ...(email && { email }),
        ...(phone && { phone }),
        billingAddress: billing,
        shippingAddress: shipping,
        ...(shopifyCustomerId && { shopifyCustomerId }),
      });
    } else if (shopifyCustomerId && !doc.shopifyCustomerId) {
      doc.shopifyCustomerId = shopifyCustomerId;
      await doc.save();
    }
    return doc;
  }

  /**
   * Transforms a raw Shopify order into normalized NAVKA Invoice & Payment documents.
   * Idempotent by shopifyOrderId.
   */
  public static async processAndSaveOrder(
    shopifyOrder: ShopifyOrder,
    businessSettings: any
  ): Promise<{ invoice: any; payment?: any }> {
    const shopifyOrderId = shopifyOrder.id.toString();
    const taxesIncluded = !!shopifyOrder.taxes_included;

    const fullName = (a?: { first_name?: string; last_name?: string }) =>
      `${a?.first_name || ''} ${a?.last_name || ''}`.trim();
    const customerName =
      fullName(shopifyOrder.customer) || fullName(shopifyOrder.billing_address) ||
      (shopifyOrder.customer ? 'Shopify Customer' : 'Online Guest Customer');
    const customerEmail = shopifyOrder.customer?.email || '';
    const customerPhone = shopifyOrder.customer?.phone || shopifyOrder.billing_address?.phone || '';

    const toAddress = (a?: ShopifyAddress) => ({
      street: a?.address1 || '',
      city: a?.city || '',
      state: a?.province || '',
      pincode: a?.zip || '',
      country: a?.country || 'India',
    });
    const billingAddress = toAddress(shopifyOrder.billing_address || shopifyOrder.customer?.default_address);
    const shippingAddress = shopifyOrder.shipping_address ? toAddress(shopifyOrder.shipping_address) : billingAddress;

    const customerDoc = await this.resolveCustomer(shopifyOrder, customerName, customerEmail, customerPhone, billingAddress, shippingAddress);

    // ---- Line items (+ shipping) ----
    let subtotal = 0, discountTotal = 0, taxableTotal = 0, gstTotal = 0;
    const items: any[] = [];

    for (const li of shopifyOrder.line_items) {
      const qty = li.quantity || 1;
      const c = this.computeLine(num(li.price), qty, num(li.total_discount), li.tax_lines, taxesIncluded);
      subtotal += c.unitPrice * qty;
      discountTotal += c.discount;
      taxableTotal += c.taxable;
      gstTotal += c.gstAmount;
      items.push({
        productName: li.title,
        hsnSac: await this.findHsn(li),
        quantity: qty,
        unitPrice: c.unitPrice,
        discount: c.discount,
        taxableAmount: c.taxable,
        gstRate: c.gstRate,
        gstAmount: c.gstAmount,
        totalAmount: c.total,
      });
    }

    for (const sl of shopifyOrder.shipping_lines || []) {
      const price = num(sl.discounted_price ?? sl.price);
      if (price <= 0) continue;
      const c = this.computeLine(price, 1, 0, sl.tax_lines, taxesIncluded);
      subtotal += c.unitPrice;
      taxableTotal += c.taxable;
      gstTotal += c.gstAmount;
      items.push({
        productName: `Shipping - ${sl.title}`,
        hsnSac: SHIPPING_SAC,
        quantity: 1,
        unitPrice: c.unitPrice,
        discount: 0,
        taxableAmount: c.taxable,
        gstRate: c.gstRate,
        gstAmount: c.gstAmount,
        totalAmount: c.total,
      });
    }

    const grandTotalFloat = taxableTotal + gstTotal;
    const grandTotal = Math.round(grandTotalFloat);
    const roundOff = round2(grandTotal - grandTotalFloat);

    const shopifyTotal = num(shopifyOrder.total_price ?? shopifyOrder.current_total_price);
    if (shopifyTotal > 0 && Math.abs(shopifyTotal - grandTotal) > 1) {
      console.warn(`[ShopifyService] Order ${shopifyOrder.name}: computed total ${grandTotal} differs from Shopify total ${shopifyTotal}`);
    }

    // ---- Payment status ----
    const fs = shopifyOrder.financial_status;
    let paymentStatus: 'PAID' | 'PENDING' | 'PARTIAL' | 'FAILED' | 'REFUNDED' = 'PENDING';
    if (fs === 'paid') paymentStatus = 'PAID';
    else if (fs === 'refunded' || fs === 'partially_refunded') paymentStatus = 'REFUNDED';
    else if (fs === 'partially_paid') paymentStatus = 'PARTIAL';
    else if (fs === 'voided') paymentStatus = 'FAILED';

    // ---- Refunds: sum every refund's successful transactions ----
    let refundDetails: any = { isRefunded: false, refundAmount: 0 };
    if (shopifyOrder.refunds && shopifyOrder.refunds.length > 0) {
      let total = 0;
      let latest = new Date(0);
      const reasons: string[] = [];
      for (const r of shopifyOrder.refunds) {
        const tx = (r.transactions || []).filter((t) => !t.status || t.status === 'success');
        total += tx.length ? tx.reduce((s, t) => s + num(t.amount), 0) : 0;
        const d = new Date(r.created_at);
        if (d > latest) latest = d;
        if (r.note) reasons.push(r.note);
      }
      if (total === 0 && fs === 'refunded') total = grandTotal; // fully refunded but no transaction detail
      refundDetails = {
        isRefunded: true,
        refundAmount: round2(total),
        refundDate: latest,
        refundReason: reasons.join('; ') || 'Processed via Shopify',
      };
    }

    const invoiceData = {
      invoiceNumber: `NAVKA-SHP-${shopifyOrder.order_number}`,
      invoiceDate: new Date(shopifyOrder.created_at),
      shopifyOrderId,
      shopifyOrderNumber: shopifyOrder.name || `#${shopifyOrder.order_number}`,
      customer: {
        customerId: customerDoc._id,
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        gstin: customerDoc.gstin,
        billingAddress,
        shippingAddress,
      },
      businessDetails: {
        name: businessSettings?.businessName || 'NAVKA Enterprises Private Limited',
        address: businessSettings?.address || 'Plot 42, Okhla Phase II, New Delhi',
        gstin: businessSettings?.gstin || '07AAAAA0000A1Z5',
        phone: businessSettings?.contactPhone || '+91 98765 43210',
        email: businessSettings?.contactEmail || 'billing@navka.com',
      },
      items,
      subtotal: round2(subtotal),
      discount: round2(discountTotal),
      taxableAmount: round2(taxableTotal),
      totalGST: round2(gstTotal),
      grandTotal,
      roundOff,
      amountInWords: convertAmountToWords(grandTotal),
      paymentStatus,
      invoiceStatus: (shopifyOrder.cancelled_at ? 'CANCELLED' : 'ACTIVE') as 'CANCELLED' | 'ACTIVE',
      source: 'SHOPIFY' as const,
      refundDetails,
      notes: shopifyOrder.note || `Imported from Shopify Order ${shopifyOrder.name}`,
    };

    const invoice = await Invoice.findOneAndUpdate(
      { shopifyOrderId },
      { $set: invoiceData },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // ---- Online payment record ----
    let paymentDoc: any = null;
    if (paymentStatus === 'PAID' || paymentStatus === 'REFUNDED') {
      const gatewayName = shopifyOrder.payment_gateway_names?.[0] || 'Shopify Gateway';
      paymentDoc = await Payment.findOneAndUpdate(
        { invoiceId: invoice._id, orderId: shopifyOrder.name },
        {
          $set: {
            invoiceId: invoice._id,
            orderId: shopifyOrder.name,
            amount: grandTotal,
            paymentDate: new Date(shopifyOrder.created_at),
            paymentMethod: 'ONLINE',
            paymentSource: 'ONLINE',
            // Only a FULL refund flips the original payment; partial refunds stay COMPLETED
            // and are tracked on invoice.refundDetails.
            paymentStatus: fs === 'refunded' ? 'REFUNDED' : 'COMPLETED',
            referenceId: `SHP-${shopifyOrder.id}`,
            notes: `Paid via ${gatewayName}`,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // Unpaid Shopify orders (e.g. COD) can have offline payments recorded by Admin.
    // Re-derive the status so a re-sync does not reset them to PENDING.
    if (paymentStatus === 'PENDING' || paymentStatus === 'PARTIAL') {
      const reconciled = await reconcileInvoicePaymentStatus(invoice._id);
      if (reconciled) invoice.paymentStatus = reconciled.paymentStatus;
    }

    return { invoice, payment: paymentDoc };
  }

  /**
   * Syncs Shopify orders into MongoDB. One bad order never aborts the batch:
   * failures are collected and returned.
   */
  public static async syncAll(options: SyncOptions = {}): Promise<SyncResult> {
    const rawOrders = await this.fetchOrders(options);
    const settings = await BusinessSettings.findOne();

    const results: any[] = [];
    const failed: SyncResult['failed'] = [];
    for (const order of rawOrders) {
      try {
        results.push(await this.processAndSaveOrder(order, settings));
      } catch (err: any) {
        failed.push({ order: order.name || String(order.id), error: err.message });
        console.error(`[ShopifyService] Failed to process order ${order.name}: ${err.message}`);
      }
    }
    return { count: results.length, failed, orders: results };
  }
}
