import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Invoice from '../models/Invoice';
import Payment from '../models/Payment';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

const computeDateRange = (period: string, customStart?: string, customEnd?: string): DateRange => {
  const now = new Date();
  let startDate: Date;
  let endDate: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      break;

    case 'thisWeek': {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      startDate = new Date(now.setDate(diff));
      startDate.setHours(0, 0, 0, 0);
      break;
    }

    case 'thisMonth':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;

    case 'lastMonth':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;

    case 'custom':
      if (customStart && customEnd) {
        startDate = new Date(customStart);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(customEnd);
        endDate.setHours(23, 59, 59, 999);
      } else {
        // Default to past 30 days
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      break;

    default: // Default: all time or past 60 days
      startDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);
      break;
  }

  return { startDate, endDate };
};

export const getDashboardMetrics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const period = (req.query.period as string) || 'all';
    const customStart = req.query.startDate as string;
    const customEnd = req.query.endDate as string;

    const { startDate, endDate } = computeDateRange(period, customStart, customEnd);

    const matchFilter: any = {
      invoiceStatus: 'ACTIVE',
      ...(period !== 'all' && {
        invoiceDate: { $gte: startDate, $lte: endDate },
      }),
    };

    // 1. Summary Aggregation
    const summaryAgg = await Invoice.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$grandTotal' },
          totalInvoices: { $sum: 1 },
          totalGST: { $sum: '$totalGST' },
          totalTaxable: { $sum: '$taxableAmount' },
          pendingAmount: {
            $sum: {
              $cond: [{ $eq: ['$paymentStatus', 'PENDING'] }, '$grandTotal', 0],
            },
          },
          refundAmount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$refundDetails.isRefunded', true] }] },
                '$refundDetails.refundAmount',
                0,
              ],
            },
          },
        },
      },
    ]);

    const summaryData = summaryAgg[0] || {
      totalSales: 0,
      totalInvoices: 0,
      totalGST: 0,
      totalTaxable: 0,
      pendingAmount: 0,
      refundAmount: 0,
    };

    // Include partial invoice unpaid balances in pending amount calculation
    // Unpaid balance of PARTIAL invoices, in one aggregation (no per-invoice queries).
    const partialAgg = await Invoice.aggregate([
      { $match: { ...matchFilter, paymentStatus: 'PARTIAL' } },
      {
        $lookup: {
          from: Payment.collection.name,
          localField: '_id',
          foreignField: 'invoiceId',
          as: 'paid',
          pipeline: [{ $match: { paymentStatus: 'COMPLETED' } }, { $project: { amount: 1 } }],
        },
      },
      {
        $group: {
          _id: null,
          balance: { $sum: { $max: [0, { $subtract: ['$grandTotal', { $sum: '$paid.amount' }] }] } },
        },
      },
    ]);
    const partialPendingAdjustment = partialAgg[0]?.balance || 0;

    const totalPending = summaryData.pendingAmount + partialPendingAdjustment;

    // 2. Payment Overview Breakdown (Paid, Pending, Failed, Refunded)
    const paymentStatusAgg = await Invoice.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$paymentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$grandTotal' },
        },
      },
    ]);

    const paymentOverview = {
      paid: { count: 0, amount: 0 },
      pending: { count: 0, amount: 0 },
      failed: { count: 0, amount: 0 },
      refunded: { count: 0, amount: 0 },
      partial: { count: 0, amount: 0 },
    };

    paymentStatusAgg.forEach((item) => {
      const statusKey = item._id.toLowerCase() as keyof typeof paymentOverview;
      if (paymentOverview[statusKey]) {
        paymentOverview[statusKey].count = item.count;
        paymentOverview[statusKey].amount = Math.round(item.totalAmount * 100) / 100;
      }
    });

    // 3. Sales Trend by Date (Daily/Weekly aggregation for charts & table)
    const salesTrendAgg = await Invoice.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$invoiceDate' } },
          sales: { $sum: '$grandTotal' },
          taxable: { $sum: '$taxableAmount' },
          gst: { $sum: '$totalGST' },
          invoiceCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const salesTrend = salesTrendAgg.map((item) => ({
      date: item._id,
      sales: Math.round(item.sales * 100) / 100,
      taxable: Math.round(item.taxable * 100) / 100,
      gst: Math.round(item.gst * 100) / 100,
      invoiceCount: item.invoiceCount,
    }));

    res.status(200).json({
      success: true,
      period,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      summary: {
        totalSales: Math.round(summaryData.totalSales * 100) / 100,
        totalInvoices: summaryData.totalInvoices,
        totalGST: Math.round(summaryData.totalGST * 100) / 100,
        pendingPayments: Math.round(totalPending * 100) / 100,
        refunds: Math.round(summaryData.refundAmount * 100) / 100,
      },
      paymentOverview,
      salesTrend,
    });
  } catch (error: any) {
    next(error);
  }
};
