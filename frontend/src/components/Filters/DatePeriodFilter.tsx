import React from 'react';
import { Calendar } from 'lucide-react';

export type PeriodType = 'all' | 'today' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

interface DatePeriodFilterProps {
  activePeriod: PeriodType;
  onPeriodChange: (period: PeriodType) => void;
  startDate?: string;
  endDate?: string;
  onCustomDateChange?: (start: string, end: string) => void;
}

export const DatePeriodFilter: React.FC<DatePeriodFilterProps> = ({
  activePeriod,
  onPeriodChange,
  startDate,
  endDate,
  onCustomDateChange,
}) => {
  const periods: { id: PeriodType; label: string }[] = [
    { id: 'all', label: 'All Time' },
    { id: 'today', label: 'Today' },
    { id: 'thisWeek', label: 'This Week' },
    { id: 'thisMonth', label: 'This Month' },
    { id: 'lastMonth', label: 'Last Month' },
    { id: 'custom', label: 'Custom' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-1.5 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
        <Calendar className="w-3.5 h-3.5 text-slate-400" />
        <span>Filter:</span>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {periods.map((p) => {
          const isActive = activePeriod === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPeriodChange(p.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {activePeriod === 'custom' && onCustomDateChange && (
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 ml-1">
          <input
            type="date"
            value={startDate || ''}
            onChange={(e) => onCustomDateChange(e.target.value, endDate || '')}
            className="text-xs px-2.5 py-1 border border-slate-300 rounded-md focus:ring-1 focus:ring-slate-800 outline-none"
          />
          <span className="text-xs text-slate-400 font-medium">to</span>
          <input
            type="date"
            value={endDate || ''}
            onChange={(e) => onCustomDateChange(startDate || '', e.target.value)}
            className="text-xs px-2.5 py-1 border border-slate-300 rounded-md focus:ring-1 focus:ring-slate-800 outline-none"
          />
        </div>
      )}
    </div>
  );
};
