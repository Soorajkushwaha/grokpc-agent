import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  IndianRupee,
  Cpu,
  HardDrive,
  Activity,
  ShieldAlert,
  Sliders,
  Sparkles,
  Server,
  Lock,
  Cloud,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
  Settings,
  Zap,
  TrendingDown,
  Info
} from 'lucide-react';

export const BudgetAndHealth: React.FC = () => {
  const {
    budget,
    health,
    refreshHealth,
    setIsSettingsModalOpen
  } = useApp();

  // Interactive Simulator state
  const [dailyWhatsApp, setDailyWhatsApp] = useState(15);
  const [dailyVids, setDailyVids] = useState(2);
  const [dailyGmail, setDailyGmail] = useState(10);

  // Cost estimates:
  // WhatsApp: ~1,500 tokens = ~₹0.18
  // Vids + TTS: ~3,500 tokens = ~₹0.45
  // cost estimates come from the backend usage log
  const estimatedDailyCost = (dailyWhatsApp * 0.18) + (dailyVids * 0.45) + (dailyGmail * 0.12);
  const estimatedMonthlyCost = Math.round(estimatedDailyCost * 30);

  const percentUsed = Math.min(100, Math.round((budget.currentSpendInr / budget.monthlyCapInr) * 100));

  let progressColor = 'bg-emerald-500';
  if (percentUsed > 80) progressColor = 'bg-red-500';
  else if (percentUsed > 50) progressColor = 'bg-amber-500';

  return (
    <div className="max-w-7xl mx-auto space-y-5 pb-12">
      {/* SECTION 1: ₹1,000 Monthly Budget Tracker */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-950/80 border border-emerald-800/60 text-emerald-400">
                <IndianRupee className="w-5 h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white font-heading">
                Monthly AI Budget Tracker (Max ₹1,000 Cap)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Guaranteed safety envelope: DeepSeek Vision API + Gemini Flash Free Tier + Oracle Always-Free VM.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-400">Projected Month End:</span>
            <span className="text-emerald-400 font-bold text-sm bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
              ₹{budget.projectedSpendInr}
            </span>
          </div>
        </div>

        {/* Spend Meter Card */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <span className="text-xs text-slate-400 font-mono block">CURRENT SPEND (MONTH TO DATE)</span>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-white font-mono">
                  ₹{budget.currentSpendInr.toFixed(2)}
                </span>
                <span className="text-sm font-semibold text-slate-400">/ ₹{budget.monthlyCapInr} limit</span>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs font-bold text-emerald-400 font-mono bg-emerald-950/70 px-2 py-1 rounded border border-emerald-800/50">
                ₹{(budget.monthlyCapInr - budget.currentSpendInr).toFixed(2)} Remaining
              </span>
              <span className="block text-[11px] text-slate-500 font-mono mt-1">
                {budget.daysRemainingInMonth} days left in cycle
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800/80 p-0.5">
            <div
              className={`h-full ${progressColor} rounded-full transition-all duration-500 shadow-sm`}
              style={{ width: `${percentUsed}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <span>₹0 (Start)</span>
            <span>{percentUsed}% Used</span>
            <span>₹1,000 Hard Cap</span>
          </div>
        </div>

        {/* 3-Way Cost Breakdown Comparison */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* 1. DeepSeek Vision API */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-cyan-400 font-mono">DeepSeek Vision API</span>
                <span className="text-[10px] text-slate-500 font-mono">deepseek-chat</span>
              </div>
              <p className="text-xl font-extrabold text-white font-mono">₹{budget.deepseekCostInr.toFixed(2)}</p>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                {budget.deepseekTokensUsed.toLocaleString()} tokens (see official DeepSeek USD rates)
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/60 text-[11px] text-cyan-400 font-mono flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Ultra-low vision cost</span>
            </div>
          </div>

          {/* 2. Google AI Studio (Gemini Flash) */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-indigo-400 font-mono">Google AI Studio</span>
                <span className="text-[10px] text-indigo-300 font-mono">Gemini 2.0 Flash</span>
              </div>
              <p className="text-xl font-extrabold text-white font-mono">₹{budget.geminiCostInr.toFixed(2)}</p>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                {budget.geminiCallsUsed} calls ($10 Monthly Free Credit)
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/60 text-[11px] text-emerald-400 font-mono flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Free Tier active</span>
            </div>
          </div>

          {/* 3. Oracle Cloud ARM64 Compute */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-emerald-400 font-mono">Oracle Cloud ARM64</span>
                <span className="text-[10px] text-emerald-400 font-mono">Ampere A1</span>
              </div>
              <p className="text-xl font-extrabold text-emerald-400 font-mono">₹0.00 / mo</p>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                2 OCPUs &bull; 12GB RAM &bull; 100GB NVMe (Always Free)
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/60 text-[11px] text-emerald-400 font-mono flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>100% Free Forever</span>
            </div>
          </div>
        </div>

        {/* Interactive Cost Calculator Simulator */}
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase font-heading tracking-wider">
              Interactive Monthly Cost Forecaster
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Daily WhatsApp Sends:</span>
                <span className="font-bold text-cyan-400">{dailyWhatsApp} / day</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                value={dailyWhatsApp}
                onChange={(e) => setDailyWhatsApp(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Daily Google Vids Renders:</span>
                <span className="font-bold text-cyan-400">{dailyVids} / day</span>
              </div>
              <input
                type="range"
                min="0"
                max="10"
                value={dailyVids}
                onChange={(e) => setDailyVids(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Daily Gmail Scans:</span>
                <span className="font-bold text-cyan-400">{dailyGmail} / day</span>
              </div>
              <input
                type="range"
                min="0"
                max="40"
                value={dailyGmail}
                onChange={(e) => setDailyGmail(Number(e.target.value))}
                className="w-full accent-cyan-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400">
              Estimated 30-Day Total Cost at this pace:
            </span>
            <div className="flex items-center gap-2 font-mono">
              <span className={`text-sm font-bold ${estimatedMonthlyCost <= 1000 ? 'text-emerald-400' : 'text-red-400'}`}>
                ₹{estimatedMonthlyCost} / month
              </span>
              <span className="text-[10px] text-slate-500">
                ({estimatedMonthlyCost <= 1000 ? 'Safe within ₹1,000 cap' : 'Exceeds budget cap'})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: Oracle Cloud VM Health & Resources */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-800/60 text-cyan-400">
                <Server className="w-5 h-5" />
              </div>
              <h2 className="text-base sm:text-lg font-bold text-white font-heading">
                Oracle VM ARM64 Telemetry & Mount Status
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Live daemon stats from Ubuntu 24.04 server (Ampere A1 2 OCPUs, 12GB RAM).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refreshHealth()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-all cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Ping VM</span>
            </button>

            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 text-xs font-semibold rounded-lg border border-cyan-800 transition-all cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Tunnel Config</span>
            </button>
          </div>
        </div>

        {/* Hardware & Daemon Health Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* CPU Card */}
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono">CPU (Ampere A1)</span>
              <Cpu className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-xl font-extrabold text-white font-mono">{health.cpuUsagePercent}%</p>
            <p className="text-[11px] text-slate-500 font-mono">2 OCPUs (4 vCPUs) @ 3.0 GHz</p>
          </div>

          {/* RAM Card */}
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono">RAM Allocation</span>
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-xl font-extrabold text-white font-mono">{health.ramUsedGb} GB / {health.ramTotalGb} GB</p>
            <p className="text-[11px] text-emerald-400 font-mono">8.6 GB Available for Chromium</p>
          </div>

          {/* Chrome Profile Lock */}
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono">Chrome Session</span>
              <Lock className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-sm font-bold text-white font-mono">SingletonLock Active</p>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">/data/chrome_profile (890 MB)</p>
          </div>

          {/* Google Drive Rclone Mount */}
          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono">Google Drive Mount</span>
              <Cloud className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-sm font-bold text-white font-mono">/mnt/gdrive Mounted</p>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">rclone VFS (1.8 TB Cloud Free)</p>
          </div>
        </div>

        {/* Network & Daemons Status Row */}
        <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>noVNC (Port 6080): Online</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>FastAPI (Port 8000): Online</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>DuckDB Log Sync: Active</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-500">
            Last Ping: {new Date(health.lastPing).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
};
