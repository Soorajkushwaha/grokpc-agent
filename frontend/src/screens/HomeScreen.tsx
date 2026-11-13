import React, { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Plus,
  Sparkles,
  IndianRupee,
  Clapperboard,
  CalendarDays,
  Ghost,
  Flame,
  Lightbulb,
  Smile,
  Bot,
  Laptop,
  Tablet,
  Cloud,
  AlertCircle,
} from 'lucide-react';
import { channelTheme, initials } from '../ui';
import { BACKEND_OPTIONS, type BackendId, type Job } from '../types';
import {
  downloadJobVideo,
  friendlyDownloadError,
  friendlyError,
  isConfigured,
} from '../api';
import { isActiveJob } from '../deviceStatus';
import { DeviceStatusCards } from '../components/DeviceStatusCards';
import { JobProgressCard, SubmittingBanner } from '../components/JobProgressCard';

const TOPIC_CHIPS: { label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { label: 'Horror kahani', Icon: Ghost },
  { label: 'Motivation', Icon: Flame },
  { label: 'Facts', Icon: Lightbulb },
  { label: 'Kids story', Icon: Smile },
];

const WORKER_ICONS: Record<BackendId, React.ReactNode> = {
  laptop: <Laptop className="w-3.5 h-3.5" />,
  tablet: <Tablet className="w-3.5 h-3.5" />,
  vps: <Cloud className="w-3.5 h-3.5" />,
};

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
    config,
    updateConfig,
    refreshHealth,
    devices,
    trackedJobs,
  } = useApp();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTopic, setPendingTopic] = useState<string | null>(null);
  const [dl, setDl] = useState<{ device: BackendId; jobId: string; progress: number | null } | null>(null);
  const [dlErrors, setDlErrors] = useState<Partial<Record<string, string>>>({});
  const busyRef = useRef(false);

  const spend = budget.spendInrToday ?? budget.currentSpendInr ?? 0;
  const videosToday = status?.today.videos ?? budget.videosToday ?? 0;
  const videoCap = status?.today.videoCap ?? budget.dailyVideoCap ?? 3;
  const spendCap = status?.today.spendCapInr ?? budget.dailySpendCapInr ?? 40;
  const autoFeature = Boolean(status?.features?.autopilot);
  const autoOn = Boolean(status?.autopilot?.enabled);

  const activeId: BackendId = config.activeBackend || 'laptop';
  const activeLabel = BACKEND_OPTIONS.find((b) => b.id === activeId)?.label || 'Laptop';
  const snap = devices[activeId];
  const runningOnSelected =
    isActiveJob(snap?.currentJob) || jobs.some((j) => isActiveJob(j));
  const watchJob: Job | null =
    snap?.currentJob ||
    (snap?.latestJob && trackedJobs[activeId]?.id === snap.latestJob.id ? snap.latestJob : null) ||
    jobs.find((j) => isActiveJob(j)) ||
    jobs.find((j) => trackedJobs[activeId]?.id === j.id) ||
    null;

  const switchWorker = (id: BackendId) => {
    const slot = config.backends?.[id] || { backendUrl: '', agentToken: '', vncUrl: '' };
    updateConfig({
      activeBackend: id,
      backends: config.backends,
      backendUrl: slot.backendUrl,
      agentToken: slot.agentToken,
      vncUrl: slot.vncUrl,
      demoMode: !isConfigured(slot),
    });
    setError(null);
    setTimeout(() => void refreshHealth(), 50);
  };

  const submit = async () => {
    const trimmed = topic.trim();
    if (!trimmed || busyRef.current) return;
    if (runningOnSelected) {
      setError('Ek video already ban raha hai — pehle uske khatam hone ka intezaar karo');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setPendingTopic(trimmed);
    try {
      await createVideoJob(trimmed);
      setTopic('');
    } catch (err) {
      setError(friendlyError(err, activeId, config.backendUrl));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPendingTopic(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  const handleDownload = async (deviceId: BackendId, job: Job) => {
    if (dl) return;
    const slot = config.backends?.[deviceId] || {
      backendUrl: config.backendUrl,
      agentToken: config.agentToken,
      vncUrl: config.vncUrl,
    };
    const key = `${deviceId}:${job.id}`;
    setDl({ device: deviceId, jobId: job.id, progress: 0 });
    setDlErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      await downloadJobVideo(
        { ...config, ...slot, backendUrl: slot.backendUrl, agentToken: slot.agentToken, vncUrl: slot.vncUrl },
        job.id,
        (pct) => setDl((cur) => (cur && cur.jobId === job.id ? { ...cur, progress: pct } : cur)),
      );
    } catch (err) {
      setDlErrors((prev) => ({
        ...prev,
        [key]: friendlyDownloadError(err, deviceId, slot.backendUrl),
      }));
    } finally {
      setDl(null);
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Channel chuno</h2>
          <button
            onClick={() => setActiveTab('settings')}
            className="text-[12px] text-cyan-400 flex items-center gap-0.5 cursor-pointer font-medium hover:text-cyan-300 min-h-[32px] px-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {channels.map((ch) => {
            const on = ch.id === selectedChannelId;
            const theme = channelTheme(ch.id);
            return (
              <button
                key={ch.id}
                onClick={() => setSelectedChannelId(ch.id)}
                className={`flex flex-col items-center text-center px-1.5 py-2.5 rounded-2xl border cursor-pointer transition-all duration-200 min-h-[88px] ${
                  on
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-white shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-400/30'
                    : 'bg-slate-900/70 border-white/8 text-slate-300 hover:border-white/16'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-xl ${theme.solid} text-white text-[11px] font-bold flex items-center justify-center shadow-md shrink-0`}
                >
                  {initials(ch.name)}
                </span>
                <span className="mt-1.5 block w-full text-[12px] font-semibold leading-tight truncate">{ch.name}</span>
                <span
                  className={`mt-1 px-1.5 py-px rounded-md text-[10px] font-medium ${
                    on ? 'bg-cyan-500/20 text-cyan-200' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {ch.language} · {ch.aspect}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-2.5">Kaunsa worker?</h2>
        <div className="grid grid-cols-3 gap-1.5">
          {BACKEND_OPTIONS.map((opt) => {
            const filled = Boolean(config.backends?.[opt.id]?.backendUrl && config.backends?.[opt.id]?.agentToken);
            const selected = activeId === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => switchWorker(opt.id)}
                className={`flex flex-col items-center gap-0.5 rounded-2xl border px-2 py-2 cursor-pointer min-h-[60px] transition-all duration-150 ${
                  selected
                    ? 'border-cyan-500/70 bg-cyan-950/70 text-white ring-1 ring-cyan-400/30'
                    : 'border-white/8 bg-slate-950/70 text-slate-300 hover:border-white/16'
                }`}
              >
                {WORKER_ICONS[opt.id]}
                <span className="text-xs font-bold">{opt.label}</span>
                {filled ? (
                  <span className="text-[9px] text-emerald-400 font-medium">saved</span>
                ) : (
                  <span className="text-[9px] text-slate-500">settings</span>
                )}
              </button>
            );
          })}
        </div>
        {activeId === 'tablet' && (
          <p className="mt-2 text-[11px] text-slate-400">
            Tablet worker: kahani + awaz + FFmpeg basic visuals. Grok / Google Vids clips ke liye Laptop chuno.
          </p>
        )}
      </section>

      <section className="hero-card p-4 space-y-3.5">
        <label className="block">
          <span className="flex items-center gap-1.5 text-[15px] font-semibold text-white font-heading">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Kya video banani hai?
          </span>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={onKeyDown}
            rows={4}
            placeholder="Jaise: Paani bachane ke 3 aasan tarike"
            className="field mt-2.5 w-full rounded-2xl px-4 py-3.5 text-[15px] text-white resize-none leading-relaxed"
          />
        </label>
        <p className="text-[11px] text-slate-500 -mt-1.5">Enter = start · Shift+Enter = nayi line</p>
        <div className="grid grid-cols-2 gap-1.5">
          {TOPIC_CHIPS.map((chip) => {
            const Icon = chip.Icon;
            const on = topic === chip.label;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => setTopic(chip.label)}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-[12px] font-medium cursor-pointer transition-all duration-150 min-h-[40px] ${
                  on
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                    : 'bg-slate-950/60 text-slate-300 border border-white/8 hover:border-cyan-500/30 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {chip.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => void submit()}
          disabled={busy || !topic.trim() || runningOnSelected}
          className="w-full py-3.5 min-h-[52px] rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-base font-bold shadow-lg shadow-cyan-900/40 disabled:opacity-50 disabled:shadow-none cursor-pointer flex items-center justify-center gap-2 transition-transform active:scale-[0.98] hover:brightness-110"
        >
          <Sparkles className="w-5 h-5" />
          {busy
            ? `${activeLabel} pe start ho rahi hai…`
            : runningOnSelected
              ? 'Ek video already ban raha hai'
              : 'Nayi Video Banao'}
        </button>
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-700/40 bg-rose-950/60 px-4 py-3 text-sm text-rose-100 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {pendingTopic && !watchJob && <SubmittingBanner deviceId={activeId} topic={pendingTopic} />}

      {watchJob && (
        <JobProgressCard
          job={watchJob}
          deviceId={activeId}
          startedAt={trackedJobs[activeId]?.id === watchJob.id ? trackedJobs[activeId]?.startedAt : undefined}
          onDownload={() => void handleDownload(activeId, watchJob)}
          downloading={Boolean(dl && dl.jobId === watchJob.id)}
          downloadProgress={dl && dl.jobId === watchJob.id ? dl.progress : null}
          downloadError={dlErrors[`${activeId}:${watchJob.id}`] || null}
        />
      )}

      <DeviceStatusCards
        devices={devices}
        backends={config.backends || {
          laptop: { backendUrl: '', agentToken: '', vncUrl: '' },
          tablet: { backendUrl: '', agentToken: '', vncUrl: '' },
          vps: { backendUrl: '', agentToken: '', vncUrl: '' },
        }}
        onDownload={(id, job) => void handleDownload(id, job)}
        downloading={dl}
        downloadErrors={dlErrors}
      />

      <section className="grid grid-cols-3 gap-2">
        <div className="card p-3 text-center">
          <IndianRupee className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
          <div className="text-lg font-bold text-emerald-400 font-heading leading-tight">₹{Math.round(spend)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">aaj / ₹{spendCap}</div>
        </div>
        <div className="card p-3 text-center">
          <Clapperboard className="w-3.5 h-3.5 text-cyan-400 mx-auto mb-1" />
          <div className="text-lg font-bold text-white font-heading leading-tight">
            {videosToday}
            <span className="text-slate-500 text-sm">/{videoCap}</span>
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">videos aaj</div>
        </div>
        <div className="card p-3 text-center">
          <CalendarDays className="w-3.5 h-3.5 text-violet-400 mx-auto mb-1" />
          <div className="text-lg font-bold text-white font-heading leading-tight">₹{Math.round(budget.currentSpendInr)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">is mahine</div>
        </div>
      </section>

      <section className="card px-4 py-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-slate-800/80 text-slate-300 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Auto mode</div>
            <div className="text-[11px] text-slate-500 leading-snug">
              {autoFeature
                ? 'Idle hone par khud video banaye'
                : 'Phase 2 — abhi off. Pehle manual banao.'}
            </div>
          </div>
        </div>
        <button
          disabled={!autoFeature}
          onClick={() => void saveSettings({ autopilot_enabled: !autoOn })}
          aria-pressed={autoOn && autoFeature}
          className={`w-12 h-7 rounded-full relative cursor-pointer disabled:opacity-40 shrink-0 transition-colors ${
            autoOn && autoFeature ? 'bg-cyan-500' : 'bg-slate-700'
          }`}
        >
          <span
            className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${
              autoOn && autoFeature ? 'right-0.5 left-auto' : 'left-0.5'
            }`}
          />
        </button>
      </section>
    </div>
  );
};
