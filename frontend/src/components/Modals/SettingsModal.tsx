import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Shield, Server, KeyRound, Monitor, Info } from 'lucide-react';

export const SettingsModal: React.FC = () => {
  const { config, updateConfig, isSettingsModalOpen, setIsSettingsModalOpen, refreshHealth, health, wsConnected } = useApp();
  const [backendUrl, setBackendUrl] = useState(config.backendUrl);
  const [agentToken, setAgentToken] = useState(config.agentToken);
  const [vncUrl, setVncUrl] = useState(config.vncUrl);
  const [demoMode, setDemoMode] = useState(config.demoMode);

  if (!isSettingsModalOpen) return null;

  const handleSave = async () => {
    const nextDemo = demoMode || !(backendUrl.trim() && agentToken.trim());
    updateConfig({
      backendUrl: backendUrl.trim().replace(/\/+$/, ''),
      agentToken: agentToken.trim(),
      vncUrl: vncUrl.trim(),
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
            API keys stay on the Oracle VM in /app/agent/.env. This phone app only stores the tunnel URL and a bearer token (localStorage is fine for a personal device).
          </p>

          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Server className="w-3.5 h-3.5 text-cyan-400" /> Cloudflare Tunnel URL (FastAPI)
            </span>
            <input
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
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
              value={agentToken}
              onChange={(e) => setAgentToken(e.target.value)}
              placeholder="from /app/agent/.env  AGENT_TOKEN"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
            />
          </label>

          <label className="block space-y-1">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Monitor className="w-3.5 h-3.5 text-cyan-400" /> noVNC URL (optional)
            </span>
            <input
              value={vncUrl}
              onChange={(e) => setVncUrl(e.target.value)}
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
              <span className="block text-[11px] text-slate-400">Fake desktop and logs, no messages are sent. Turns off automatically once URL + token are saved, unless you leave this checked.</span>
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
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
