import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { BACKEND_OPTIONS, type BackendId, type BackendSlot, type Channel } from '../types';
import { emptyBackends, isConfigured } from '../api';
import {
  Laptop,
  Tablet,
  Cloud,
  Plus,
  Trash2,
  ChevronDown,
  Tv,
  Wallet,
  PenLine,
  Wrench,
  AlertTriangle,
  Check,
} from 'lucide-react';
import { OracleCodeViewer } from '../components/OracleCode/OracleCodeViewer';
import { channelTheme, initials } from '../ui';

const ICONS: Record<BackendId, React.ReactNode> = {
  laptop: <Laptop className="w-4 h-4" />,
  tablet: <Tablet className="w-4 h-4" />,
  vps: <Cloud className="w-4 h-4" />,
};

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3.5 py-3 text-sm font-semibold text-white cursor-pointer min-h-[52px] hover:bg-white/[0.02] transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-slate-800/90 text-cyan-300 flex items-center justify-center">
            {icon}
          </span>
          {title}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3.5 pb-4 space-y-3 animate-fade-in">{children}</div>}
    </section>
  );
};

export const SettingsScreen: React.FC = () => {
  const {
    config,
    updateConfig,
    refreshHealth,
    health,
    wsConnected,
    channels,
    saveChannel,
    removeChannel,
    settings,
    saveSettings,
    styleProfile,
    saveStyle,
    status,
  } = useApp();

  const [active, setActive] = useState<BackendId>(config.activeBackend || 'laptop');
  const [backends, setBackends] = useState(() => config.backends || emptyBackends());
  const [demoMode, setDemoMode] = useState(config.demoMode);
  const [saved, setSaved] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setActive(config.activeBackend || 'laptop');
    setBackends(config.backends || emptyBackends());
    setDemoMode(config.demoMode);
  }, [config]);

  const slot: BackendSlot = backends[active] || { backendUrl: '', agentToken: '', vncUrl: '' };
  const patchSlot = (partial: Partial<BackendSlot>) => {
    setBackends((prev) => ({ ...prev, [active]: { ...prev[active], ...partial } }));
  };

  const handleSave = () => {
    const chosen = backends[active] || { backendUrl: '', agentToken: '', vncUrl: '' };
    const nextDemo = !isConfigured(chosen);
    updateConfig({
      activeBackend: active,
      backends,
      backendUrl: chosen.backendUrl.trim().replace(/\/+$/, ''),
      agentToken: chosen.agentToken.trim(),
      vncUrl: chosen.vncUrl.trim(),
      demoMode: nextDemo,
    });
    setDemoMode(nextDemo);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    setTimeout(() => void refreshHealth(), 50);
  };

  return (
    <div className="space-y-3">
      <section className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2.5 font-heading">
          <span className="w-8 h-8 rounded-lg bg-slate-800/90 text-cyan-300 flex items-center justify-center">
            <Laptop className="w-4 h-4" />
          </span>
          Kaunsa machine?
        </h2>
        <div className="grid grid-cols-3 gap-1.5">
          {BACKEND_OPTIONS.map((opt) => {
            const filled = Boolean(backends[opt.id]?.backendUrl && backends[opt.id]?.agentToken);
            const selected = active === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setActive(opt.id)}
                className={`flex flex-col items-center gap-0.5 rounded-2xl border px-2 py-2 cursor-pointer min-h-[64px] transition-all duration-150 ${
                  selected
                    ? 'border-cyan-500/70 bg-cyan-950/70 text-white ring-1 ring-cyan-400/30 shadow-lg shadow-cyan-950/30'
                    : 'border-white/8 bg-slate-950/70 text-slate-300 hover:border-white/16'
                }`}
              >
                {ICONS[opt.id]}
                <span className="text-xs font-bold">{opt.label}</span>
                {filled && <span className="text-[9px] text-emerald-400 font-medium">saved</span>}
              </button>
            );
          })}
        </div>
        {active === 'tablet' && (
          <p className="text-[11px] text-cyan-200/90 flex items-start gap-1.5 bg-cyan-950/40 border border-cyan-800/30 rounded-xl px-2.5 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Termux (F-Droid) me yeh command chalao, phir URL + token yahan paste karo:
              <span className="block mt-1 font-mono text-[10px] text-cyan-100 break-all">
                curl -fsSL https://raw.githubusercontent.com/Soorajkushwaha/grokpc-agent/main/scripts/tablet/install.sh | bash
              </span>
              Tablet pe story (Gemini/DeepSeek), gTTS aur FFmpeg basic visuals chalte hain. Grok Imagine / Google Vids laptop pe hi rahenge.
            </span>
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Backend URL</span>
          <input
            value={slot.backendUrl}
            onChange={(e) => patchSlot({ backendUrl: e.target.value })}
            placeholder="https://xxxx.trycloudflare.com"
            className="field w-full rounded-xl px-3 py-2 text-sm text-white font-mono min-h-[40px]"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Agent token</span>
          <input
            type="password"
            value={slot.agentToken}
            onChange={(e) => patchSlot({ agentToken: e.target.value })}
            placeholder="AGENT_TOKEN"
            className="field w-full rounded-xl px-3 py-2 text-sm text-white font-mono min-h-[40px]"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">noVNC URL (optional)</span>
          <input
            value={slot.vncUrl}
            onChange={(e) => patchSlot({ vncUrl: e.target.value })}
            placeholder="khali chhodo to /novnc use hoga"
            className="field w-full rounded-xl px-3 py-2 text-sm text-white font-mono min-h-[40px]"
          />
        </label>
        {demoMode && (
          <p className="text-[11px] text-amber-300 flex items-start gap-1.5 bg-amber-950/40 border border-amber-800/30 rounded-xl px-2.5 py-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            URL + token dono daal ke Save dabao — tab asli video banegi.
          </p>
        )}
        <button
          onClick={handleSave}
          className="w-full py-2.5 min-h-[44px] rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold cursor-pointer shadow-lg shadow-cyan-900/30 flex items-center justify-center gap-2 hover:brightness-110 transition-all"
        >
          {saved ? (
            <>
              <Check className="w-4 h-4" /> Saved
            </>
          ) : (
            `Save & use ${BACKEND_OPTIONS.find((b) => b.id === active)?.label}`
          )}
        </button>
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
              health.connected
                ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800/40'
                : 'text-slate-400 bg-slate-900 border-slate-700'
            }`}
          >
            {health.connected ? 'connected' : 'offline'}
          </span>
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
              wsConnected
                ? 'text-emerald-300 bg-emerald-950/50 border-emerald-800/40'
                : 'text-slate-400 bg-slate-900 border-slate-700'
            }`}
          >
            WS {wsConnected ? 'open' : 'closed'}
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border text-slate-400 bg-slate-900 border-slate-700 font-mono">
            {health.hostname}
            {health.ramTotalGb ? ` · RAM ${health.ramUsedGb}/${health.ramTotalGb}G` : ''}
          </span>
        </div>
      </section>

      <Section title="Channels" icon={<Tv className="w-4 h-4" />} defaultOpen>
        {channels.map((ch) => (
          <ChannelEditor key={ch.id} channel={ch} onSave={(c) => void saveChannel(c)} onDelete={() => void removeChannel(ch.id)} />
        ))}
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Naya channel naam"
            className="field flex-1 rounded-xl px-3 py-2.5 text-sm text-white min-h-[44px]"
          />
          <button
            onClick={() => {
              if (!newName.trim()) return;
              void saveChannel({ name: newName.trim() });
              setNewName('');
            }}
            className="w-11 min-w-[44px] min-h-[44px] rounded-xl bg-slate-800 text-cyan-300 cursor-pointer flex items-center justify-center hover:bg-slate-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </Section>

      <Section title="Budget caps & quiet hours" icon={<Wallet className="w-4 h-4" />}>
        <label className="block text-[11px] text-slate-400">
          Quiet hours
          <input
            defaultValue={settings?.quiet_hours || '23:00-07:00'}
            onBlur={(e) => void saveSettings({ quiet_hours: e.target.value })}
            className="field mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white font-mono min-h-[44px]"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] text-slate-400">
            Videos / din
            <input
              type="number"
              defaultValue={settings?.daily_video_cap ?? 3}
              onBlur={(e) => void saveSettings({ daily_video_cap: Number(e.target.value) })}
              className="field mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white min-h-[44px]"
            />
          </label>
          <label className="block text-[11px] text-slate-400">
            ₹ cap / din
            <input
              type="number"
              defaultValue={settings?.daily_spend_cap_inr ?? 40}
              onBlur={(e) => void saveSettings({ daily_spend_cap_inr: Number(e.target.value) })}
              className="field mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white min-h-[44px]"
            />
          </label>
        </div>
        <label className="block text-[11px] text-slate-400">
          Idle seconds (Phase 2 auto)
          <input
            type="number"
            defaultValue={settings?.idle_seconds ?? 900}
            onBlur={(e) => void saveSettings({ idle_seconds: Number(e.target.value) })}
            className="field mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white min-h-[44px]"
          />
        </label>
        <p className="text-[11px] text-slate-500">
          Auto mode Phase 2 hai (flag off). Caps save ho jayenge, use tab hoga jab autopilot on hoga.
        </p>
      </Section>

      <Section title="Sooraj ka style (planning)" icon={<PenLine className="w-4 h-4" />}>
        <label className="block text-[11px] text-slate-400">
          Tone
          <textarea
            defaultValue={styleProfile?.tone || ''}
            rows={2}
            onBlur={(e) => void saveStyle({ tone: e.target.value })}
            className="field mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white"
          />
        </label>
        <label className="block text-[11px] text-slate-400">
          Sochne ka tarika
          <textarea
            defaultValue={styleProfile?.thinking_style || ''}
            rows={3}
            onBlur={(e) => void saveStyle({ thinking_style: e.target.value })}
            className="field mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-white"
          />
        </label>
      </Section>

      <Section title="Advanced" icon={<Wrench className="w-4 h-4" />}>
        <p className="text-[11px] text-slate-500">
          Phase {status?.phase ?? 1}. Features:{' '}
          {Object.entries(status?.features || {})
            .map(([k, v]) => `${k}:${v ? 'on' : 'off'}`)
            .join(' · ') || 'backend se load honge'}
        </p>
        <p className="text-[11px] text-slate-500">
          Helper: {status?.helper?.reachable ? 'connected' : 'offline'}
          {status?.helper?.capcut_installed ? ' · CapCut mila' : ''}
        </p>
        <p className="text-[11px] text-slate-600">API keys is app me nahi aati — sirf machine ke .env me rehti hain.</p>
        <details className="text-[12px] text-slate-400">
          <summary className="cursor-pointer text-slate-300">Backend code</summary>
          <div className="mt-2 -mx-2">
            <OracleCodeViewer />
          </div>
        </details>
      </Section>
    </div>
  );
};

const ChannelEditor: React.FC<{
  channel: Channel;
  onSave: (c: Channel) => void;
  onDelete: () => void;
}> = ({ channel, onSave, onDelete }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(channel.name);
  const [niche, setNiche] = useState(channel.niche);
  const [language, setLanguage] = useState(channel.language);
  const [style, setStyle] = useState(channel.style);
  const [aspect, setAspect] = useState(channel.aspect);
  useEffect(() => {
    setName(channel.name);
    setNiche(channel.niche);
    setLanguage(channel.language);
    setStyle(channel.style);
    setAspect(channel.aspect);
  }, [channel]);
  const theme = channelTheme(channel.id);
  return (
    <div className="border border-white/8 rounded-xl p-2 bg-slate-950/40">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 flex items-center gap-2.5 text-left text-sm text-white cursor-pointer min-h-[40px] px-1">
          <span className={`w-7 h-7 rounded-lg ${theme.solid} text-white text-[10px] font-bold flex items-center justify-center shrink-0`}>
            {initials(channel.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{channel.name}</span>
            <span className="block text-[10px] text-slate-500">
              {channel.language} · {channel.aspect}
            </span>
          </span>
        </button>
        <button onClick={onDelete} className="p-2 min-w-[36px] min-h-[36px] text-slate-500 hover:text-rose-400 cursor-pointer" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2 animate-fade-in">
          <input value={name} onChange={(e) => setName(e.target.value)} className="field w-full rounded-lg px-2.5 py-2 text-sm text-white" />
          <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Niche" className="field w-full rounded-lg px-2.5 py-2 text-sm text-white" />
          <div className="flex gap-2">
            <input value={language} onChange={(e) => setLanguage(e.target.value)} className="field flex-1 rounded-lg px-2.5 py-2 text-sm text-white" />
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="field rounded-lg px-2.5 py-2 text-sm text-white">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
          <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Style" className="field w-full rounded-lg px-2.5 py-2 text-sm text-white" />
          <button
            onClick={() => onSave({ ...channel, name, niche, language, style, aspect })}
            className="text-xs font-semibold text-cyan-400 cursor-pointer px-1 py-1"
          >
            Save channel
          </button>
        </div>
      )}
    </div>
  );
};
