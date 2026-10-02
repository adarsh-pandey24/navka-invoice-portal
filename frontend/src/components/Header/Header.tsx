import React, { useState } from 'react';
import { LogOut, RefreshCw, ShoppingBag, Check } from 'lucide-react';
import { User } from '../../types';
import apiClient from '../../services/api';

interface HeaderProps {
  user?: User | null;
  onLogout?: () => void;
  pageTitle?: string;
  onSyncComplete?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  onLogout,
  pageTitle = 'Overview',
  onSyncComplete,
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';

  const handleSyncShopify = async () => {
    setIsSyncing(true);
    setSyncMessage(null);
    try {
      const res = await apiClient.post('/shopify/sync');
      if (res.data?.success) {
        setSyncMessage(`Synced ${res.data.syncedCount} orders`);
        if (onSyncComplete) onSyncComplete();
        setTimeout(() => setSyncMessage(null), 4000);
      }
    } catch (err: any) {
      setSyncMessage(err.response?.data?.message || 'Sync failed');
      setTimeout(() => setSyncMessage(null), 4000);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-20 px-8 flex items-center justify-between shadow-sm print:hidden">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-800 tracking-tight">{pageTitle}</h2>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-4">
        {/* Shopify Sync Button for Admin Only */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            {syncMessage && (
              <span className="text-xs px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-medium flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-600" />
                <span>{syncMessage}</span>
              </span>
            )}
            <button
              onClick={handleSyncShopify}
              disabled={isSyncing}
              title="Sync latest Shopify orders"
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition border border-slate-200/80 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-emerald-600' : ''}`} />
              <ShoppingBag className="w-3.5 h-3.5 text-slate-500" />
              <span>{isSyncing ? 'Syncing...' : 'Sync Shopify'}</span>
            </button>
          </div>
        )}

        {/* User Profile Pill */}
        <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-700 font-semibold text-xs">
            {user?.name ? user.name.slice(0, 2).toUpperCase() : 'NA'}
          </div>
          <div className="hidden sm:block text-left">
            <p className="text-xs font-bold text-slate-800 leading-tight">
              {user?.name || 'Administrator'}
            </p>
            <p className="text-[11px] text-slate-500 font-medium">
              {user?.email || 'admin@navka.com'}
            </p>
          </div>
        </div>

        {/* Logout Button */}
        {onLogout && (
          <button
            onClick={onLogout}
            title="Sign out"
            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
