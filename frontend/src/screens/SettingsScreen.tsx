import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { BACKEND_OPTIONS, type BackendId, type BackendSlot, type Channel } from '../types';
import { emptyBackends, isConfigured } from '../api';
import { Laptop, Tablet, Cloud, Plus, Trash2, ChevronDown } from 'lucide-react';
import { OracleCodeViewer } from '../components/OracleCode/OracleCodeViewer';

const ICONS: Record<BackendId, React.ReactNode> = {
  laptop: <Laptop className="w-4 h-4" />,
  tablet: <Tablet className="w-4 h-4" />,
  vps: <Cloud className="w-4 h-4" />,
};

const Section: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({
  title,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-white cursor-pointer"
      >
        {title}
        <ChevronDown className={`w-4 h-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
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
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-white">Kaunsa machine?</h2>
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
                  selected ? 'border-cyan-600 bg-cyan-950/70 text-white' : 'border-slate-800 bg-slate-950 text-slate-300'
                }`}
              >
                {ICONS[opt.id]}
                <span className="text-xs font-bold">{opt.label}</span>
                {filled && <span className="text-[9px] text-emerald-400">saved</span>}
              </button>
            );
          })}
        </div>
        {active === 'tablet' && (
          <p className="text-[11px] text-amber-300">Tablet Phase 2 hai — abhi setup later. Pehle Laptop use karo.</p>
        )}
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Backend URL</span>
          <input
            value={slot.backendUrl}
            onChange={(e) => patchSlot({ backendUrl: e.target.value })}
            placeholder="https://xxxx.trycloudflare.com"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">Agent token</span>
          <input
            type="password"
            value={slot.agentToken}
            onChange={(e) => patchSlot({ agentToken: e.target.value })}
            placeholder="AGENT_TOKEN"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-slate-400">noVNC URL (optional)</span>
          <input
            value={slot.vncUrl}
            onChange={(e) => patchSlot({ vncUrl: e.target.value })}
            placeholder="khali chhodo to /novnc use hoga"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
        </label>
        {demoMode && (
          <p className="text-[11px] text-amber-300">URL + token dono daal ke Save dabao — tab asli video banegi.</p>
        )}
        <button
          onClick={handleSave}
          className="w-full py-2.5 rounded-xl bg-cyan-600 text-white text-sm font-bold cursor-pointer"
        >
          {saved ? 'Saved' : `Save & use ${BACKEND_OPTIONS.find((b) => b.id === active)?.label}`}
        </button>
        <p className="text-[11px] font-mono text-slate-500">
          {health.connected ? 'connected' : 'offline'} · WS {wsConnected ? 'open' : 'closed'} · {health.hostname}
          {health.ramTotalGb ? ` · RAM ${health.ramUsedGb}/${health.ramTotalGb}G` : ''}
        </p>
      </section>

      <Section title="Channels" defaultOpen>
        {channels.map((ch) => (
          <ChannelEditor key={ch.id} channel={ch} onSave={(c) => void saveChannel(c)} onDelete={() => void removeChannel(ch.id)} />
        ))}
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Naya channel naam"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
          />
          <button
            onClick={() => {
              if (!newName.trim()) return;
              void saveChannel({ name: newName.trim() });
              setNewName('');
            }}
            className="px-3 rounded-lg bg-slate-800 text-cyan-300 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </Section>

      <Section title="Budget caps & quiet hours">
        <label className="block text-[11px] text-slate-400">
          Quiet hours
          <input
            defaultValue={settings?.quiet_hours || '23:00-07:00'}
            onBlur={(e) => void saveSettings({ quiet_hours: e.target.value })}
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white font-mono"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] text-slate-400">
            Videos / din
            <input
              type="number"
              defaultValue={settings?.daily_video_cap ?? 3}
              onBlur={(e) => void saveSettings({ daily_video_cap: Number(e.target.value) })}
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="block text-[11px] text-slate-400">
            ₹ cap / din
            <input
              type="number"
              defaultValue={settings?.daily_spend_cap_inr ?? 40}
              onBlur={(e) => void saveSettings({ daily_spend_cap_inr: Number(e.target.value) })}
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
            />
          </label>
        </div>
        <label className="block text-[11px] text-slate-400">
          Idle seconds (Phase 2 auto)
          <input
            type="number"
            defaultValue={settings?.idle_seconds ?? 900}
            onBlur={(e) => void saveSettings({ idle_seconds: Number(e.target.value) })}
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
          />
        </label>
        <p className="text-[11px] text-slate-500">
          Auto mode Phase 2 hai (flag off). Caps save ho jayenge, use tab hoga jab autopilot on hoga.
        </p>
      </Section>

      <Section title="Sooraj ka style (planning)">
        <label className="block text-[11px] text-slate-400">
          Tone
          <textarea
            defaultValue={styleProfile?.tone || ''}
            rows={2}
            onBlur={(e) => void saveStyle({ tone: e.target.value })}
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block text-[11px] text-slate-400">
          Sochne ka tarika
          <textarea
            defaultValue={styleProfile?.thinking_style || ''}
            rows={3}
            onBlur={(e) => void saveStyle({ thinking_style: e.target.value })}
            className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white"
          />
        </label>
      </Section>

      <Section title="Advanced">
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
  return (
    <div className="border border-slate-800 rounded-xl p-2">
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 text-left text-sm text-white cursor-pointer">
          {channel.name}
        </button>
        <button onClick={onDelete} className="p-1 text-slate-500 hover:text-rose-400 cursor-pointer" title="Delete">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-white" />
          <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Niche" className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-white" />
          <div className="flex gap-2">
            <input value={language} onChange={(e) => setLanguage(e.target.value)} className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-white" />
            <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-white">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
          <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Style" className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-white" />
          <button
            onClick={() => onSave({ ...channel, name, niche, language, style, aspect })}
            className="text-xs text-cyan-400 cursor-pointer"
          >
            Save channel
          </button>
        </div>
      )}
    </div>
  );
};
