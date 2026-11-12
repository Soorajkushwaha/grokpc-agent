import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Plus, Sparkles } from 'lucide-react';

export const HomeScreen: React.FC = () => {
  const {
    channels,
    selectedChannelId,
    setSelectedChannelId,
    setActiveTab,
    createVideoJob,
    budget,
    status,
    jobs,
    saveSettings,
  } = useApp();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const spend = budget.spendInrToday ?? budget.currentSpendInr ?? 0;
  const videosToday = status?.today.videos ?? budget.videosToday ?? 0;
  const videoCap = status?.today.videoCap ?? budget.dailyVideoCap ?? 3;
  const spendCap = status?.today.spendCapInr ?? budget.dailySpendCapInr ?? 40;
  const running = jobs.find((j) => j.status === 'running' || j.status === 'queued');
  const autoFeature = Boolean(status?.features?.autopilot);
  const autoOn = Boolean(status?.autopilot?.enabled);

  const submit = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    try {
      await createVideoJob(topic.trim());
      setTopic('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Channel chuno</h2>
          <button
            onClick={() => setActiveTab('settings')}
            className="text-[11px] text-cyan-400 flex items-center gap-0.5 cursor-pointer"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {channels.map((ch) => {
            const on = ch.id === selectedChannelId;
            return (
              <button
                key={ch.id}
                onClick={() => setSelectedChannelId(ch.id)}
                className={`shrink-0 px-4 py-2.5 rounded-2xl border text-sm font-semibold cursor-pointer ${
                  on
                    ? 'bg-cyan-600 border-cyan-500 text-white shadow-lg shadow-cyan-900/40'
                    : 'bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                {ch.name}
                <span className="block text-[10px] font-normal opacity-70">{ch.language} · {ch.aspect}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="bg-slate-900/80 border border-slate-800 rounded-3xl p-4 space-y-3">
        <label className="block">
          <span className="text-sm font-semibold text-white">Kya video banani hai?</span>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            placeholder="Jaise: Paani bachane ke 3 aasan tarike"
            className="mt-2 w-full bg-slate-950 border border-slate-800 rounded-2xl px-4 py-3 text-base text-white placeholder:text-slate-600 resize-none"
          />
        </label>
        <button
          onClick={() => void submit()}
          disabled={busy || !topic.trim()}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-base font-bold shadow-lg shadow-cyan-900/40 disabled:opacity-40 cursor-pointer flex items-center justify-center gap-2"
        >
          <Sparkles className="w-5 h-5" />
          {busy ? 'Start ho rahi hai…' : 'Nayi Video Banao'}
        </button>
      </section>

      {running && (
        <button
          onClick={() => setActiveTab('jobs')}
          className="w-full text-left bg-cyan-950/50 border border-cyan-800/50 rounded-2xl px-4 py-3 cursor-pointer"
        >
          <div className="text-[11px] uppercase tracking-wide text-cyan-400 font-semibold">Abhi chal raha hai</div>
          <div className="text-sm text-white font-medium truncate">{running.topic}</div>
          <div className="text-[11px] text-slate-400">{running.current_step} · {running.status}</div>
        </button>
      )}

      <section className="grid grid-cols-3 gap-2">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-center">
          <div className="text-lg font-bold text-emerald-400">₹{Math.round(spend)}</div>
          <div className="text-[10px] text-slate-500">aaj / ₹{spendCap}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-center">
          <div className="text-lg font-bold text-white">{videosToday}<span className="text-slate-500 text-sm">/{videoCap}</span></div>
          <div className="text-[10px] text-slate-500">videos aaj</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 text-center">
          <div className="text-lg font-bold text-white">₹{Math.round(budget.currentSpendInr)}</div>
          <div className="text-[10px] text-slate-500">is mahine</div>
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Auto mode</div>
          <div className="text-[11px] text-slate-500">
            {autoFeature
              ? 'Idle hone par khud video banaye'
              : 'Phase 2 — abhi off. Pehle manual banao.'}
          </div>
        </div>
        <button
          disabled={!autoFeature}
          onClick={() => void saveSettings({ autopilot_enabled: !autoOn })}
          className={`w-12 h-7 rounded-full relative cursor-pointer disabled:opacity-40 ${autoOn && autoFeature ? 'bg-cyan-500' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 ${autoOn && autoFeature ? 'right-0.5' : 'left-0.5'} w-6 h-6 bg-white rounded-full shadow`} />
        </button>
      </section>
    </div>
  );
};
