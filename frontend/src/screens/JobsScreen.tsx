import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { STEP_LABELS, type Job } from '../types';
import { Pause, Play, X, ChevronDown, ShieldCheck } from 'lucide-react';

function statusColor(s: string) {
  if (s === 'success' || s === 'completed') return 'bg-emerald-500';
  if (s === 'running' || s === 'queued') return 'bg-cyan-400 animate-pulse';
  if (s === 'failed') return 'bg-rose-500';
  if (s === 'skipped') return 'bg-slate-600';
  if (s === 'paused' || s === 'waiting_credits' || s === 'waiting_login' || s === 'waiting_approval') return 'bg-amber-400';
  return 'bg-slate-700';
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    queued: 'Queue me',
    running: 'Chal raha',
    paused: 'Ruka hua',
    completed: 'Ready',
    failed: 'Fail',
    cancelled: 'Cancel',
    waiting_credits: 'Credits ka intezaar',
    waiting_login: 'Login chahiye',
    waiting_approval: 'Publish approve karo',
  };
  return map[s] || s;
}

const JobCard: React.FC<{ job: Job }> = ({ job }) => {
  const { channels, pauseJob, resumeJob, cancelJob, approvePublish, status } = useApp();
  const [open, setOpen] = useState(false);
  const ch = channels.find((c) => c.id === job.channel_id);
  const canPublish = Boolean(status?.features?.youtube_upload) && job.status === 'waiting_approval';
  const title = job.plan?.title || job.topic;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white truncate">{title}</div>
          <div className="text-[11px] text-slate-500">
            {ch?.name || job.channel_id} · {statusLabel(job.status)}
          </div>
        </div>
        <span className={`mt-1 shrink-0 w-2.5 h-2.5 rounded-full ${statusColor(job.status)}`} />
      </div>

      <div className="flex items-center gap-1">
        {(job.steps || []).map((step, i) => (
          <React.Fragment key={step.name}>
            {i > 0 && <div className="flex-1 h-px bg-slate-800" />}
            <div className="flex flex-col items-center min-w-[3.2rem]">
              <span className={`w-2.5 h-2.5 rounded-full ${statusColor(step.status)}`} />
              <span className="text-[9px] mt-1 text-slate-400">{STEP_LABELS[step.name] || step.name}</span>
            </div>
          </React.Fragment>
        ))}
      </div>

      {job.error && job.status === 'failed' && (
        <p className="text-[11px] text-rose-300 break-words">{job.error}</p>
      )}
      {job.final_path && job.status === 'completed' && (
        <p className="text-[11px] text-slate-400 font-mono truncate">File: {job.final_path}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {(job.status === 'running' || job.status === 'queued') && (
          <button onClick={() => void pauseJob(job.id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 cursor-pointer">
            <Pause className="w-3 h-3" /> Pause
          </button>
        )}
        {(job.status === 'paused' || job.status === 'failed' || job.status === 'waiting_login' || job.status === 'waiting_credits') && (
          <button onClick={() => void resumeJob(job.id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-cyan-700 text-white cursor-pointer">
            <Play className="w-3 h-3" /> Resume
          </button>
        )}
        {canPublish && (
          <button onClick={() => void approvePublish(job.id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white cursor-pointer">
            <ShieldCheck className="w-3 h-3" /> Public karo
          </button>
        )}
        {job.status !== 'completed' && job.status !== 'cancelled' && (
          <button onClick={() => void cancelJob(job.id)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-rose-300 cursor-pointer">
            <X className="w-3 h-3" /> Cancel
          </button>
        )}
        <button onClick={() => setOpen((v) => !v)} className="ml-auto flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
          Details <ChevronDown className={`w-3.5 h-3.5 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="text-[11px] text-slate-400 space-y-1.5 border-t border-slate-800 pt-2">
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
  if (!jobs.length) {
    return (
      <div className="text-center py-16 space-y-3">
        <p className="text-slate-400">Abhi koi video nahi bani.</p>
        <button onClick={() => setActiveTab('home')} className="text-cyan-400 font-semibold cursor-pointer">
          Home se nayi video banao
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-white">Aapki videos</h2>
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </div>
  );
};
