import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { downloadJobVideo, friendlyDownloadError } from '../api';
import { STEP_LABELS, type Job, type JobStep } from '../types';
import {
  Pause,
  Play,
  X,
  ChevronDown,
  ShieldCheck,
  Clapperboard,
  BookOpen,
  Mic,
  Scissors,
  Film,
  Upload,
  Check,
  Circle,
  Sparkles,
  Folder,
  AlertCircle,
  Download,
} from 'lucide-react';
import { channelTheme, initials, relativeTime } from '../ui';

function statusMeta(s: string): { dot: string; badge: string; label: string } {
  const labels: Record<string, string> = {
    queued: 'Queue me',
    running: 'Chal raha',
    paused: 'Ruka hua',
    completed: 'Ready',
    success: 'Ready',
    failed: 'Fail',
    cancelled: 'Cancel',
    waiting_credits: 'Credits ka intezaar',
    waiting_login: 'Login chahiye',
    waiting_approval: 'Publish approve karo',
  };
  if (s === 'success' || s === 'completed') {
    return { dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', label: labels[s] };
  }
  if (s === 'running' || s === 'queued') {
    return {
      dot: s === 'running' ? 'bg-cyan-400 step-running' : 'bg-cyan-400 animate-pulse',
      badge: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      label: labels[s],
    };
  }
  if (s === 'failed') {
    return { dot: 'bg-rose-500', badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30', label: labels[s] };
  }
  if (s === 'skipped' || s === 'cancelled') {
    return { dot: 'bg-slate-600', badge: 'bg-slate-800 text-slate-400 border-slate-700', label: labels[s] || s };
  }
  if (s === 'paused' || s === 'waiting_credits' || s === 'waiting_login' || s === 'waiting_approval') {
    return { dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30', label: labels[s] };
  }
  if (s === 'pending') {
    return { dot: 'bg-slate-600', badge: 'bg-slate-800 text-slate-400 border-slate-700', label: 'Pending' };
  }
  return { dot: 'bg-slate-600', badge: 'bg-slate-800 text-slate-400 border-slate-700', label: labels[s] || s };
}

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  story: BookOpen,
  voiceover: Mic,
  visuals: Film,
  generate: Film,
  edit: Scissors,
  upload: Upload,
};

function StepBar({ steps }: { steps: JobStep[] }) {
  if (!steps.length) return null;
  return (
    <div className="flex items-start">
      {steps.map((step, i) => {
        const Icon = STEP_ICONS[step.name] || Circle;
        const done = step.status === 'success' || step.status === 'completed';
        const running = step.status === 'running';
        const failed = step.status === 'failed';
        return (
          <React.Fragment key={step.name}>
            {i > 0 && (
              <div
                className={`flex-1 h-0.5 mt-[15px] rounded-full ${
                  done || steps[i - 1].status === 'success' || steps[i - 1].status === 'completed'
                    ? 'bg-gradient-to-r from-emerald-400/80 to-cyan-400/60'
                    : running || steps[i - 1].status === 'running'
                      ? 'bg-gradient-to-r from-cyan-400/70 to-slate-700'
                      : 'bg-slate-800'
                }`}
              />
            )}
            <div className="flex flex-col items-center min-w-[3.4rem]">
              <span
                className={`w-[30px] h-[30px] rounded-full flex items-center justify-center border transition-colors ${
                  done
                    ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                    : running
                      ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200 step-running'
                      : failed
                        ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                        : 'bg-slate-900 border-slate-700 text-slate-500'
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              </span>
              <span className={`text-[10px] mt-1.5 font-medium ${running ? 'text-cyan-300' : done ? 'text-slate-300' : 'text-slate-500'}`}>
                {STEP_LABELS[step.name] || step.name}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

const READY_STATUSES = new Set(['completed', 'success', 'waiting_approval']);

const JobCard: React.FC<{ job: Job; onToast?: (kind: 'ok' | 'error', text: string) => void }> = ({
  job,
  onToast,
}) => {
  const { channels, pauseJob, resumeJob, cancelJob, approvePublish, status, config } = useApp();
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const ch = channels.find((c) => c.id === job.channel_id);
  const canPublish = Boolean(status?.features?.youtube_upload) && job.status === 'waiting_approval';
  const canDownload = READY_STATUSES.has(job.status) || Boolean(job.final_path || job.video_path);
  const title = job.plan?.title || job.topic;
  const meta = statusMeta(job.status);
  const theme = channelTheme(job.channel_id || '');
  const when = relativeTime(job.updated_at || job.created_at);
  const isRunning = job.status === 'running' || job.status === 'queued';

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    setProgress(0);
    try {
      const name = await downloadJobVideo(config, job.id, (pct) => setProgress(pct));
      onToast?.('ok', `${name} download ho gayi`);
    } catch (err) {
      const msg = friendlyDownloadError(err, config.activeBackend, config.backendUrl);
      onToast?.('error', msg || 'Download fail ho gaya');
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  return (
    <div className={`card p-4 space-y-3.5 ${isRunning ? 'ring-1 ring-cyan-400/25' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            className={`w-8 h-8 rounded-xl ${theme.solid} text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5`}
          >
            {initials(ch?.name || job.channel_id)}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white leading-snug">{title}</div>
            <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>{ch?.name || job.channel_id}</span>
              {when && (
                <>
                  <span className="text-slate-700">·</span>
                  <span>{when}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full border ${meta.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
      </div>

      <StepBar steps={job.steps || []} />

      {job.error && job.status === 'failed' && (
        <p className="text-[11px] text-rose-300 break-words flex items-start gap-1.5 bg-rose-950/40 border border-rose-900/40 rounded-xl px-2.5 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {job.error}
        </p>
      )}
      {(job.final_path || job.video_path) && READY_STATUSES.has(job.status) && (
        <p className="text-[11px] text-slate-400 font-mono truncate flex items-center gap-1.5 bg-slate-950/50 rounded-xl px-2.5 py-2 border border-white/5">
          <Folder className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">{job.final_path || job.video_path}</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {canDownload && !isRunning && (
          <button
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="flex items-center gap-1 text-xs px-3 py-2 min-h-[36px] rounded-xl bg-emerald-700 text-white cursor-pointer hover:bg-emerald-600 transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            <Download className="w-3 h-3" />
            {downloading
              ? progress == null
                ? 'Downloading…'
                : `Downloading… ${progress}%`
              : '⬇️ PC me download'}
          </button>
        )}
        {(job.status === 'running' || job.status === 'queued') && (
          <button
            onClick={() => void pauseJob(job.id)}
            className="flex items-center gap-1 text-xs px-3 py-2 min-h-[36px] rounded-xl bg-slate-800 text-slate-200 cursor-pointer hover:bg-slate-700 transition-colors"
          >
            <Pause className="w-3 h-3" /> Pause
          </button>
        )}
        {(job.status === 'paused' || job.status === 'failed' || job.status === 'waiting_login' || job.status === 'waiting_credits') && (
          <button
            onClick={() => void resumeJob(job.id)}
            className="flex items-center gap-1 text-xs px-3 py-2 min-h-[36px] rounded-xl bg-cyan-700 text-white cursor-pointer hover:bg-cyan-600 transition-colors"
          >
            <Play className="w-3 h-3" /> Resume
          </button>
        )}
        {canPublish && (
          <button
            onClick={() => void approvePublish(job.id)}
            className="flex items-center gap-1 text-xs px-3 py-2 min-h-[36px] rounded-xl bg-emerald-700 text-white cursor-pointer hover:bg-emerald-600 transition-colors"
          >
            <ShieldCheck className="w-3 h-3" /> Public karo
          </button>
        )}
        {job.status !== 'completed' && job.status !== 'cancelled' && (
          <button
            onClick={() => void cancelJob(job.id)}
            className="flex items-center gap-1 text-xs px-3 py-2 min-h-[36px] rounded-xl bg-slate-800 text-rose-300 cursor-pointer hover:bg-slate-700 transition-colors"
          >
            <X className="w-3 h-3" /> Cancel
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex items-center gap-1 text-xs text-slate-400 cursor-pointer px-2 py-2 min-h-[36px] hover:text-slate-200"
        >
          Details <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="text-[11px] text-slate-400 space-y-1.5 border-t border-white/6 pt-2.5 animate-fade-in">
          {(job.steps || []).map((s) => (
            <div key={s.name}>
              <span className="text-slate-200 font-medium">{STEP_LABELS[s.name] || s.name}</span>
              {' · '}
              {s.status}
              {s.detail ? ` — ${s.detail}` : ''}
            </div>
          ))}
          {(job.recent_logs || []).slice(0, 6).map((l) => (
            <div key={l.id} className="font-mono text-slate-500 truncate">
              {l.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const JobsScreen: React.FC = () => {
  const { jobs, setActiveTab } = useApp();
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const showToast = (kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast((cur) => (cur?.text === text ? null : cur)), 4500);
  };
  if (!jobs.length) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-16 px-6">
        <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center mb-4 glow-cyan">
          <Clapperboard className="w-8 h-8 text-cyan-400" />
        </div>
        <h3 className="text-white font-semibold text-base font-heading">Abhi koi video nahi bani</h3>
        <p className="text-sm text-slate-400 mt-1.5 max-w-[16rem]">Home pe topic likho, phir yahan progress dikhegi.</p>
        <button
          onClick={() => setActiveTab('home')}
          className="mt-6 px-5 py-3 min-h-[48px] rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold shadow-lg shadow-cyan-900/40 cursor-pointer inline-flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          Nayi video banao
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-sm font-semibold text-white font-heading">Aapki videos</h2>
        <span className="text-[11px] text-slate-500">{jobs.length} {jobs.length === 1 ? "video" : "videos"}</span>
      </div>
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} onToast={showToast} />
      ))}
      {toast && (
        <div
          role="status"
          className={`fixed left-1/2 -translate-x-1/2 bottom-[max(5.5rem,calc(4.25rem+env(safe-area-inset-bottom)))] z-50 max-w-[90vw] px-4 py-2.5 rounded-2xl text-sm shadow-lg border ${
            toast.kind === 'error'
              ? 'bg-rose-950/95 text-rose-100 border-rose-500/40'
              : 'bg-emerald-950/95 text-emerald-100 border-emerald-500/40'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
};
