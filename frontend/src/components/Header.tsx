import React from 'react';
import { useApp } from '../context/AppContext';
import {
  Cpu,
  HardDrive,
  Settings,
  QrCode,
  Wifi,
  Sparkles,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';

export const Header: React.FC = () => {
  const {
    health,
    budget,
    config,
    wsConnected,
    refreshHealth,
    setIsTakeoverModalOpen,
    setIsSettingsModalOpen,
    isAgentRunning,
    currentAgentTask
  } = useApp();

  return (
    <header className="sticky top-0 z-40 bg-slate-950/85 backdrop-blur-md border-b border-slate-800/80 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
        {/* Logo & Agent Identity */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold shadow-lg shadow-cyan-500/20">
              <Sparkles className="w-5 h-5 text-cyan-200 animate-pulse" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-950 ring-2 ring-emerald-500/20" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm sm:text-base font-bold text-white tracking-tight truncate font-heading">
                GrokPC <span className="text-cyan-400 font-mono text-xs font-semibold px-1.5 py-0.5 bg-cyan-950/60 border border-cyan-800/50 rounded-md">ARM64</span>
              </h1>
              <span className={`hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-mono border ${
                config.demoMode
                  ? 'text-amber-300 bg-amber-950/60 border-amber-800/40'
                  : health.connected
                    ? 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40'
                    : 'text-slate-400 bg-slate-900 border-slate-700'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${config.demoMode ? 'bg-amber-400' : health.connected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                {config.demoMode ? 'Demo' : health.connected ? (wsConnected ? 'Live' : 'API up') : 'Offline'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate font-mono">
              {isAgentRunning ? (
                <span className="text-cyan-300 animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  {currentAgentTask || 'Agent executing workflow...'}
                </span>
              ) : (
                config.demoMode ? 'Demo mode — open Settings to connect your VM' : 'Oracle Cloud Ubuntu • Persistent Chrome'
              )}
            </p>
          </div>
        </div>

        {/* Quick System Telemetry & Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Quick Metrics: RAM & Budget */}
          <div className="hidden md:flex items-center gap-2 px-2.5 py-1 bg-slate-900/90 border border-slate-800 rounded-lg text-xs font-mono">
            <div className="flex items-center gap-1 text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>{health.ramUsedGb}G / {health.ramTotalGb}G</span>
            </div>
            <div className="h-3 w-px bg-slate-700" />
            <div className="flex items-center gap-1 text-slate-300">
              <span className="text-emerald-400 font-semibold">₹{budget.currentSpendInr}</span>
              <span className="text-slate-500">/ ₹1k</span>
            </div>
          </div>

          {/* Manual Login / Scan QR Button (One-Time Auth Takeover) */}
          <button
            onClick={() => setIsTakeoverModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-1.5 bg-gradient-to-r from-emerald-600/90 to-teal-600/90 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold rounded-lg shadow-md shadow-emerald-950/40 border border-emerald-400/30 transition-all active:scale-95 cursor-pointer"
            title="Take over browser session to scan WhatsApp QR or log into Google"
          >
            <QrCode className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-100" />
            <span className="hidden xs:inline">Manual Login</span>
            <span className="xs:hidden">Auth</span>
          </button>

          {/* Refresh Ping */}
          <button
            onClick={() => refreshHealth()}
            className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
            title="Refresh Oracle VM Connection"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          {/* Settings Modal Trigger */}
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 rounded-lg transition-colors cursor-pointer"
            title="Connection & API Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
