import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  CreditCard, 
  BarChart3, 
  Settings, 
  PlusCircle, 
  ShieldCheck,
  Building2
} from 'lucide-react';
import { UserRole } from '../../types';

interface SidebarProps {
  userRole?: UserRole;
  collapsed?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ userRole = 'ADMIN' }) => {
  const isAdmin = userRole === 'ADMIN';

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/invoices', label: 'Invoices', icon: FileText },
    { to: '/payments', label: 'Payments', icon: CreditCard },
    { to: '/reports', label: 'Sales Report', icon: BarChart3 },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-200 flex flex-col h-screen fixed left-0 top-0 z-30 border-r border-slate-800 shadow-xl print:hidden">
      {/* Brand Header */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800 gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-900/40">
          <Building2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-lg text-white tracking-tight">NAVKA</h1>
          <p className="text-xs text-slate-400 font-medium tracking-wide">INVOICE & BILLING</p>
        </div>
      </div>

      {/* Role Badge Indicator */}
      <div className="px-6 py-3 border-b border-slate-800/60 bg-slate-950/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span className="text-xs text-slate-400 uppercase font-semibold">Active Role</span>
        </div>
        <span
          className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
            isAdmin
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
          }`}
        >
          {userRole}
        </span>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/30 font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Quick Action Button for Admin Only */}
      {isAdmin && (
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/20">
          <NavLink
            to="/invoices/create"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-emerald-950/40"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Generate Invoice</span>
          </NavLink>
        </div>
      )}

      {/* Footer Info */}
      <div className="px-6 py-3 text-xs text-slate-500 border-t border-slate-800/60">
        NAVKA App v1.0.0 (GST)
      </div>
    </aside>
  );
};
