import React from 'react';
import { useApp } from '../context/AppContext';
import { BACKEND_OPTIONS } from '../types';
import { Sparkles, RefreshCw } from 'lucide-react';

export const Header: React.FC = () => {
  const { health, budget, config, wsConnected, refreshHealth, isAgentRunning, currentAgentTask, status } = useApp();
  const backend = BACKEND_OPTIONS.find((b) => b.id === config.activeBackend)?.label || 'Backend';
  const live = !config.demoMode && health.connected;
  const spend = budget.spendInrToday ?? budget.currentSpendInr;

  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-2.5">
      <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 shrink-0">
            <Sparkles className="w-5 h-5 text-cyan-100" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-base font-bold text-white tracking-tight font-heading">GrokPC</h1>
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${
                  config.demoMode
                    ? 'text-amber-300 bg-amber-950/60 border-amber-800/40'
                    : live
                      ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40'
                      : 'text-slate-400 bg-slate-900 border-slate-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${config.demoMode ? 'bg-amber-400' : live ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {config.demoMode ? 'Demo' : live ? (wsConnected ? backend : 'API') : 'Offline'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
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
        <div className="flex items-center gap-1">
          <div className="text-right px-2">
            <div className="text-xs font-semibold text-emerald-400">₹{Math.round(spend)}</div>
            <div className="text-[10px] text-slate-500">aaj</div>
          </div>
          <button
            onClick={() => void refreshHealth()}
            className="p-2 text-slate-400 hover:text-cyan-300 rounded-lg cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
