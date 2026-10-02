import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardLayout } from '../components/Layout/DashboardLayout';
import { LoginPage } from '../pages/Login';
import { ProtectedRoute } from '../components/ProtectedRoute';

// Pages load on demand so the login screen does not download charts and reports.
const DashboardPage = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.DashboardPage })));
const InvoiceListPage = lazy(() => import('../pages/InvoiceList').then((m) => ({ default: m.InvoiceListPage })));
const InvoiceDetailPage = lazy(() => import('../pages/InvoiceDetail').then((m) => ({ default: m.InvoiceDetailPage })));
const InvoiceCreatePage = lazy(() => import('../pages/InvoiceCreate').then((m) => ({ default: m.InvoiceCreatePage })));
const PaymentsPage = lazy(() => import('../pages/Payments').then((m) => ({ default: m.PaymentsPage })));
const SalesReportPage = lazy(() => import('../pages/SalesReport').then((m) => ({ default: m.SalesReportPage })));
const SettingsPage = lazy(() => import('../pages/Settings').then((m) => ({ default: m.SettingsPage })));

const PageLoader = () => <div className="py-24 text-center text-sm text-slate-400">Loading...</div>;

export const AppRoutes: React.FC = () => {
  return (
    <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Public Route */}
      <Route path="/login" element={<LoginPage />} />

      {/* Protected Routes inside DashboardLayout */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        
        {/* Invoices */}
        <Route path="/invoices" element={<InvoiceListPage />} />
        {/* Admin only: Invoice Creation — must be registered before :id */}
        <Route
          path="/invoices/create"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <InvoiceCreatePage />
            </ProtectedRoute>
          }
        />
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />

        {/* Payments — CA view/filter/export only (record/edit hidden in page) */}
        <Route path="/payments" element={<PaymentsPage />} />

        {/* Sales Reports */}
        <Route path="/reports" element={<SalesReportPage />} />

        {/* Settings — Admin edits, CA view-only (inputs disabled) */}
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
  );
};
