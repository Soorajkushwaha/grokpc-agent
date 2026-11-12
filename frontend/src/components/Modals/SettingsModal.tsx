import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BACKEND_OPTIONS, type BackendId, type BackendSlot } from '../../types';
import { emptyBackends, isConfigured } from '../../api';
import { X, Shield, Server, KeyRound, Monitor, Info, Laptop, Tablet, Cloud } from 'lucide-react';

const ICONS: Record<BackendId, React.ReactNode> = {
  laptop: <Laptop className="w-3.5 h-3.5" />,
  tablet: <Tablet className="w-3.5 h-3.5" />,
  vps: <Cloud className="w-3.5 h-3.5" />,
};

export const SettingsModal: React.FC = () => {
  const { config, updateConfig, isSettingsModalOpen, setIsSettingsModalOpen, refreshHealth, health, wsConnected } = useApp();
  const [active, setActive] = useState<BackendId>(config.activeBackend || 'laptop');
  const [backends, setBackends] = useState(() => config.backends || emptyBackends());
  const [demoMode, setDemoMode] = useState(config.demoMode);

  useEffect(() => {
    if (!isSettingsModalOpen) return;
    setActive(config.activeBackend || 'laptop');
    setBackends(config.backends || emptyBackends());
    setDemoMode(config.demoMode);
  }, [isSettingsModalOpen, config]);

  if (!isSettingsModalOpen) return null;

  const slot: BackendSlot = backends[active] || { backendUrl: '', agentToken: '', vncUrl: '' };
  const patchSlot = (partial: Partial<BackendSlot>) => {
    setBackends((prev) => ({ ...prev, [active]: { ...prev[active], ...partial } }));
  };

  const handleSave = async () => {
    const chosen = backends[active] || { backendUrl: '', agentToken: '', vncUrl: '' };
    const nextDemo = demoMode || !isConfigured(chosen);
    updateConfig({
      activeBackend: active,
      backends,
      backendUrl: chosen.backendUrl.trim().replace(/\/+$/, ''),
      agentToken: chosen.agentToken.trim(),
      vncUrl: chosen.vncUrl.trim(),
      demoMode: nextDemo,
    });
    setDemoMode(nextDemo);
    setIsSettingsModalOpen(false);
    setTimeout(() => void refreshHealth(), 50);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-lg bg-slate-950 border border-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">Connection settings</h2>
          </div>
          <button onClick={() => setIsSettingsModalOpen(false)} className="p-1.5 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 text-cyan-500 shrink-0" />
            API keys stay on the machine in ~/.grokpc/.env or /app/agent/.env. This app only stores tunnel URLs and a bearer token per backend (Laptop, Tablet, VPS).
          </p>

          <div>
            <span className="block text-xs font-semibold text-slate-300 mb-1.5">Active backend</span>
            <div className="grid grid-cols-3 gap-1.5">
              {BACKEND_OPTIONS.map((opt) => {
                const filled = Boolean(backends[opt.id]?.backendUrl && backends[opt.id]?.agentToken);
                const selected = active === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setActive(opt.id)}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 cursor-pointer ${
                      selected
                        ? 'border-cyan-600 bg-cyan-950/70 text-white'
                        : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {ICONS[opt.id]}
                    <span className="text-xs font-bold">{opt.label}</span>
                    <span className="text-[10px] text-slate-400">{opt.hint}</span>
                    {filled && <span className="text-[9px] font-mono text-emerald-400">saved</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Server className="w-3.5 h-3.5 text-cyan-400" /> Cloudflare Tunnel URL (FastAPI)
            </span>
            <input
              value={slot.backendUrl}
              onChange={(e) => patchSlot({ backendUrl: e.target.value })}
              placeholder="https://xxxx.trycloudflare.com"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </label>

          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <KeyRound className="w-3.5 h-3.5 text-cyan-400" /> Agent token
            </span>
            <input
              type="password"
              value={slot.agentToken}
              onChange={(e) => patchSlot({ agentToken: e.target.value })}
              placeholder="AGENT_TOKEN from the device .env"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </label>

          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Monitor className="w-3.5 h-3.5 text-cyan-400" /> noVNC URL (optional)
            </span>
            <input
              value={slot.vncUrl}
              onChange={(e) => patchSlot({ vncUrl: e.target.value })}
              placeholder="Leave empty to use /novnc on the same tunnel"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </label>

          <label className="flex items-start gap-2 p-3 rounded-xl border border-slate-800 bg-slate-900/60 cursor-pointer">
            <input
              type="checkbox"
              checked={demoMode}
              onChange={(e) => setDemoMode(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-semibold text-white">Demo mode</span>
              <span className="block text-[11px] text-slate-400">Fake desktop and logs, no messages are sent. Turns off automatically once the selected backend has a URL + token, unless you leave this checked.</span>
            </span>
          </label>

          <div className="text-[11px] font-mono text-slate-400 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2">
            Health: {health.connected ? 'connected' : 'offline'} · WS: {wsConnected ? 'open' : 'closed'} · {health.hostname}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
          <button onClick={() => setIsSettingsModalOpen(false)} className="px-3 py-1.5 text-xs text-slate-300 hover:text-white cursor-pointer">
            Cancel
          </button>
          <button onClick={() => void handleSave()} className="px-4 py-1.5 text-xs font-bold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer">
            Save & use {BACKEND_OPTIONS.find((b) => b.id === active)?.label}
          </button>
        </div>
      </div>
    </div>
  );
};
