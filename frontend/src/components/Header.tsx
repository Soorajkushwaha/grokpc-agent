import React from 'react';
import { useApp } from '../context/AppContext';
import { BACKEND_OPTIONS } from '../types';
import { Sparkles, RefreshCw } from 'lucide-react';

export const Header: React.FC = () => {
  const { health, budget, config, refreshHealth, isAgentRunning, currentAgentTask, status } = useApp();
  const backend = BACKEND_OPTIONS.find((b) => b.id === config.activeBackend)?.label || 'Backend';
  const live = !config.demoMode && health.connected;
  const spend = budget.spendInrToday ?? budget.currentSpendInr;
  const busy = isAgentRunning || Boolean(status?.currentJob);

  const pill = config.demoMode
    ? {
        label: 'Demo',
        wrap: 'text-amber-300 bg-amber-950/70 border-amber-700/50',
        dot: 'bg-amber-400',
        pulse: false,
      }
    : live
      ? {
          label: `Live · ${backend}`,
          wrap: 'text-emerald-300 bg-emerald-950/70 border-emerald-700/50',
          dot: 'bg-emerald-400',
          pulse: true,
        }
      : {
          label: 'Offline',
          wrap: 'text-slate-400 bg-slate-900/80 border-slate-700/70',
          dot: 'bg-slate-500',
          pulse: false,
        };

  return (
    <header className="sticky top-0 z-40 bg-[#070b12]/80 backdrop-blur-xl border-b border-white/5 px-4 pt-[max(0.65rem,env(safe-area-inset-top))] pb-2.5">
      <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-500 via-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 shrink-0 ring-1 ring-white/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[17px] font-bold text-white tracking-tight font-heading leading-none">GrokPC</h1>
              <span
                className={`inline-flex items-center gap-1.5 text-[10px] leading-none px-2 py-1 rounded-full font-semibold border ${pill.wrap}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${pill.dot} ${pill.pulse ? 'live-dot' : ''}`}
                />
                {pill.label}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              {isAgentRunning ? (
                <span className="text-cyan-300">{currentAgentTask || 'Agent kaam kar raha hai…'}</span>
              ) : status?.currentJob ? (
                <span className="text-cyan-300">Video: {status.currentJob.topic}</span>
              ) : (
                'Video studio'
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <div className="text-right rounded-full bg-emerald-950/40 border border-emerald-900/40 px-2.5 py-1">
            <div className="text-xs font-semibold text-emerald-400 leading-none">₹{Math.round(spend)}</div>
            <div className="text-[9px] text-slate-500 mt-0.5 leading-none">aaj</div>
          </div>
          <button
            onClick={() => void refreshHealth()}
            className="p-2.5 min-w-[40px] min-h-[40px] text-slate-400 hover:text-cyan-300 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      {busy && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden bg-cyan-950/50">
          <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-shimmer" />
        </div>
      )}
    </header>
  );
};
