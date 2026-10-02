import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../Sidebar/Sidebar';
import { Header } from '../Header/Header';
import { useAuth } from '../../context/AuthContext';

export const DashboardLayout: React.FC = () => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Fixed Left Sidebar */}
      <Sidebar userRole={user?.role || 'ADMIN'} />

      {/* Main Content Area */}
      <div className="flex-1 ml-64 flex flex-col min-h-screen print:ml-0">
        <Header
          user={user}
          onLogout={logout}
        />
        <main className="flex-1 p-8 overflow-y-auto">
          {/* Keeps sidebar and header visible while a lazy page loads. */}
          <Suspense fallback={<div className="py-24 text-center text-sm text-slate-400">Loading...</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
};
