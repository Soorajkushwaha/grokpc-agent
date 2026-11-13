import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Clapperboard, Download, Folder } from 'lucide-react';
import { STEP_LABELS, type BackendId, type Job } from '../types';
import { isActiveJob, isReadyJob, SAVED_FOLDERS } from '../deviceStatus';

const STEPS = ['story', 'voiceover', 'visuals', 'edit'] as const;

function elapsedLabel(startMs: number | null, endMs: number | null, now: number): string {
  if (!startMs) return '';
  const end = endMs || now;
  const s = Math.max(0, Math.floor((end - startMs) / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function jobProgressPercent(job: Job | null | undefined): number {
  if (!job) return 0;
  if (isReadyJob(job) && !isActiveJob(job) && job.status !== 'failed') return 100;
  const steps = job.steps?.length ? job.steps : STEPS.map((name) => ({ name, status: 'pending', detail: '' }));
  const total = steps.length || 4;
  let score = 0;
  for (const step of steps) {
    if (step.status === 'success' || step.status === 'completed' || step.status === 'skipped') score += 1;
    else if (step.status === 'running') score += 0.55;
    else if (step.status === 'failed') score += 0.3;
  }
  return Math.max(4, Math.min(96, Math.round((score / total) * 100)));
}

export function latestLogLine(job: Job | null | undefined): string {
  const logs = job?.recent_logs || [];
  return (logs[0]?.message || job?.error || '').trim();
}

export const JobProgressCard: React.FC<{
  job: Job;
  deviceId: BackendId;
  startedAt?: number | null;
  onDownload?: () => void;
  downloading?: boolean;
  downloadProgress?: number | null;
  downloadError?: string | null;
}> = ({ job, deviceId, startedAt, onDownload, downloading, downloadProgress, downloadError }) => {
  const [now, setNow] = useState(Date.now());
  const running = isActiveJob(job);
  const ready = isReadyJob(job) && !running && job.status !== 'failed';
  const failed = job.status === 'failed';
  const label = deviceId === 'tablet' ? 'Tablet' : deviceId === 'vps' ? 'VPS' : 'Laptop';

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running, job.id]);

  const start = startedAt || Date.parse(job.created_at || '') || Date.now();
  const end = !running ? Date.parse(job.updated_at || '') || Date.now() : null;
  const elapsed = elapsedLabel(Number.isFinite(start) ? start : null, end && Number.isFinite(end) ? end : null, now);
  const percent = jobProgressPercent(job);
  const stepName = STEP_LABELS[job.current_step] || job.current_step || '';
  const log = latestLogLine(job);
  const steps = useMemo(() => {
    const raw = job.steps?.length ? job.steps : STEPS.map((name) => ({ name, status: 'pending' as const, detail: '' }));
    return raw.filter((s) => s.name !== 'upload');
  }, [job.steps]);

  let headline = `⏳ Kaam chal raha hai (${label})`;
  let tone = 'border-cyan-700/40 bg-cyan-950/50 text-cyan-100';
  if (ready) {
    headline = '✅ Video ready — Download';
    tone = 'border-emerald-700/40 bg-emerald-950/50 text-emerald-100';
  } else if (failed) {
    headline = `❌ Video fail ho gayi (${label})`;
    tone = 'border-rose-700/40 bg-rose-950/50 text-rose-100';
  } else if (job.status === 'paused') {
    headline = `⏸️ Ruka hua (${label})`;
    tone = 'border-amber-700/40 bg-amber-950/40 text-amber-100';
  }

  return (
    <section className={`rounded-2xl border px-4 py-3.5 space-y-3 ${tone}`} aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-bold leading-snug">{headline}</div>
          <div className="text-sm text-white font-medium truncate mt-0.5">{job.plan?.title || job.topic}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] font-semibold text-white/90">{stepName}</div>
          {elapsed && <div className="text-[10px] text-white/60 tabular-nums">{elapsed}</div>}
        </div>
      </div>

      <div>
        <div className="h-2 rounded-full bg-black/30 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              failed ? 'bg-rose-400' : ready ? 'bg-emerald-400' : 'bg-gradient-to-r from-cyan-400 to-blue-400'
            }`}
            style={{ width: `${ready ? 100 : percent}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between gap-1">
          {steps.map((step) => {
            const done = step.status === 'success' || step.status === 'completed' || step.status === 'skipped';
            const on = step.status === 'running';
            const bad = step.status === 'failed';
            return (
              <span
                key={step.name}
                className={`flex-1 text-center text-[10px] font-semibold ${
                  on ? 'text-cyan-200' : done ? 'text-emerald-300' : bad ? 'text-rose-300' : 'text-white/40'
                }`}
              >
                {on ? '● ' : done ? '✓ ' : bad ? '✕ ' : ''}
                {STEP_LABELS[step.name] || step.name}
              </span>
            );
          })}
        </div>
      </div>

      {log && !failed && (
        <p className="text-[11px] font-mono text-white/70 truncate" title={log}>
          {log}
        </p>
      )}
      {failed && job.error && (
        <p className="text-[11px] text-rose-200 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="break-words">{job.error}</span>
        </p>
      )}

      {ready && (
        <div className="flex flex-col gap-2">
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading}
              className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {downloading
                ? downloadProgress == null
                  ? 'Downloading…'
                  : `Downloading… ${downloadProgress}%`
                : '⬇️ Download'}
            </button>
          )}
          <p className="text-[11px] text-emerald-200/90 flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 shrink-0" />
            💾 Saved in {SAVED_FOLDERS[deviceId]}
          </p>
          {downloadError && (
            <p className="text-[11px] text-rose-200 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{downloadError}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export const SubmittingBanner: React.FC<{ deviceId: BackendId; topic: string }> = ({ deviceId, topic }) => {
  const label = deviceId === 'tablet' ? 'Tablet' : deviceId === 'vps' ? 'VPS' : 'Laptop';
  return (
    <section className="rounded-2xl border border-cyan-700/40 bg-cyan-950/50 px-4 py-3.5" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-cyan-400/20 step-running" />
          <Clapperboard className="w-4 h-4 text-cyan-300 relative" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-cyan-100">⏳ {label} ko request ja rahi hai…</div>
          <div className="text-sm text-white truncate">{topic}</div>
        </div>
      </div>
    </section>
  );
};

export const ReadyCheck: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <span className="inline-flex items-center gap-1 text-emerald-300">
    <Check className="w-3 h-3" />
    {children}
  </span>
);
