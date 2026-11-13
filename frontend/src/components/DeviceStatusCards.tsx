import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Cloud,
  Download,
  Folder,
  Laptop,
  Maximize2,
  Monitor,
  Tablet,
} from 'lucide-react';
import { novncIframeUrl, previewDataUrl, type StoredConfig } from '../api';
import { BACKEND_OPTIONS, STEP_LABELS, type BackendId, type BackendSlot, type Job } from '../types';
import { isActiveJob, isReadyJob, type DeviceSnapshot } from '../deviceStatus';
import { jobProgressPercent, latestLogLine } from './JobProgressCard';

const ICONS: Record<BackendId, React.ReactNode> = {
  laptop: <Laptop className="w-4 h-4" />,
  tablet: <Tablet className="w-4 h-4" />,
  vps: <Cloud className="w-4 h-4" />,
};

function statusPill(snap: DeviceSnapshot): { label: string; wrap: string; dot: string } {
  if (!snap.configured) {
    return { label: 'not configured', wrap: 'text-slate-400 bg-slate-900 border-slate-700', dot: 'bg-slate-500' };
  }
  if (snap.tokenError) {
    return { label: 'token galat', wrap: 'text-amber-300 bg-amber-950/60 border-amber-700/40', dot: 'bg-amber-400' };
  }
  if (!snap.online) {
    return { label: 'Offline', wrap: 'text-rose-300 bg-rose-950/50 border-rose-700/40', dot: 'bg-rose-400' };
  }
  return { label: 'Online', wrap: 'text-emerald-300 bg-emerald-950/60 border-emerald-700/40', dot: 'bg-emerald-400 live-dot' };
}

function jobHeadline(job: Job | null, snap: DeviceSnapshot): string | null {
  if (!job) return null;
  if (isActiveJob(job)) return `⏳ Kaam chal raha hai (${snap.label})`;
  if (job.status === 'failed') return '❌ Fail';
  if (job.status === 'paused') return '⏸️ Ruka hua';
  if (isReadyJob(job)) return '✅ Video ready — Download';
  return job.status;
}

export const DeviceStatusCards: React.FC<{
  devices: Record<BackendId, DeviceSnapshot>;
  backends: Record<BackendId, BackendSlot>;
  onDownload: (id: BackendId, job: Job) => void;
  downloading?: { device: BackendId; jobId: string; progress: number | null } | null;
  downloadErrors?: Partial<Record<string, string>>;
}> = ({ devices, backends, onDownload, downloading, downloadErrors }) => {
  return (
    <section className="space-y-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Devices</h2>
      <div className="space-y-2.5">
        {BACKEND_OPTIONS.map((opt) => (
          <DeviceCard
            key={opt.id}
            snap={devices[opt.id]}
            slot={backends[opt.id] || { backendUrl: '', agentToken: '', vncUrl: '' }}
            onDownload={onDownload}
            downloading={downloading}
            downloadError={downloadErrors?.[`${opt.id}:${(devices[opt.id]?.currentJob || devices[opt.id]?.latestJob)?.id || ''}`]}
          />
        ))}
      </div>
    </section>
  );
};

const DeviceCard: React.FC<{
  snap: DeviceSnapshot;
  slot: BackendSlot;
  onDownload: (id: BackendId, job: Job) => void;
  downloading?: { device: BackendId; jobId: string; progress: number | null } | null;
  downloadError?: string;
}> = ({ snap, slot, onDownload, downloading, downloadError }) => {
  const [liveOpen, setLiveOpen] = useState(false);
  const pill = statusPill(snap);
  const job = snap.currentJob || (snap.latestJob && (isReadyJob(snap.latestJob) || snap.latestJob.status === 'failed') ? snap.latestJob : snap.latestJob);
  const headline = jobHeadline(job, snap);
  const ready = job && isReadyJob(job) && !isActiveJob(job) && job.status !== 'failed';
  const running = job && isActiveJob(job);
  const previewUrl = previewDataUrl(snap.preview);
  const log = snap.preview?.log_line || latestLogLine(job);
  const isDl = downloading && job && downloading.device === snap.id && downloading.jobId === job.id ? downloading : null;

  const novnc = useMemo(() => {
    if (snap.id !== 'laptop' || !slot.backendUrl || !slot.agentToken) return '';
    const cfg = { backendUrl: slot.backendUrl, agentToken: slot.agentToken, vncUrl: slot.vncUrl } as StoredConfig;
    return novncIframeUrl(cfg, { viewOnly: true, quality: 'fast' });
  }, [snap.id, slot.backendUrl, slot.agentToken, slot.vncUrl]);

  return (
    <article className="card p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-xl bg-slate-800 text-cyan-300 flex items-center justify-center shrink-0">
            {ICONS[snap.id]}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white leading-none">{snap.label}</div>
            {snap.hostname ? (
              <div className="text-[10px] text-slate-500 truncate mt-0.5">{snap.hostname}</div>
            ) : (
              <div className="text-[10px] text-slate-500 mt-0.5">{BACKEND_OPTIONS.find((b) => b.id === snap.id)?.hint}</div>
            )}
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-1 rounded-full border ${pill.wrap}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${pill.dot}`} />
          {pill.label}
        </span>
      </div>

      {!snap.configured && (
        <p className="text-[11px] text-slate-400">
          Settings me URL + token daalo. {snap.id === 'vps' ? 'Teesra worker — khali ho toh yahi "not configured" dikhega.' : ''}
        </p>
      )}

      {snap.configured && snap.error && !running && (
        <p className="text-[11px] text-rose-300 flex items-start gap-1.5 bg-rose-950/40 border border-rose-900/40 rounded-xl px-2.5 py-2">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span className="break-words">{snap.error}</span>
        </p>
      )}

      {job && headline && (
        <div className="space-y-1.5">
          <div className="text-[12px] font-semibold text-white">{headline}</div>
          <div className="text-[12px] text-slate-300 truncate">{job.plan?.title || job.topic}</div>
          {running && (
            <>
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-400 transition-all duration-500"
                  style={{ width: `${jobProgressPercent(job)}%` }}
                />
              </div>
              <div className="text-[10px] text-cyan-300">
                {STEP_LABELS[job.current_step] || job.current_step} · {job.status}
              </div>
            </>
          )}
          {log && (
            <p className="text-[10px] font-mono text-slate-500 truncate" title={log}>
              {log}
            </p>
          )}
        </div>
      )}

      {snap.configured && snap.online && !job && !snap.error && (
        <p className="text-[11px] text-slate-500">Abhi koi job nahi — Free hai.</p>
      )}

      {/* Live views */}
      {snap.id === 'laptop' && novnc && snap.configured && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setLiveOpen((v) => !v)}
              className="flex-1 min-h-[36px] rounded-xl bg-slate-800 border border-white/8 text-[12px] font-semibold text-slate-200 cursor-pointer hover:border-cyan-500/40 hover:text-white flex items-center justify-center gap-1.5"
            >
              <Monitor className="w-3.5 h-3.5" />
              🖥️ Live screen
            </button>
            <button
              type="button"
              onClick={() => window.open(novnc, '_blank', 'noopener,noreferrer')}
              className="min-w-[36px] min-h-[36px] px-2 rounded-xl bg-slate-800 border border-white/8 text-slate-300 cursor-pointer hover:text-white"
              title="Naya tab"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {liveOpen && (
            <div className="aspect-video rounded-xl overflow-hidden bg-black border border-white/8">
              <iframe title="Laptop live screen" src={novnc} className="w-full h-full border-0" allow="clipboard-read; clipboard-write" />
            </div>
          )}
        </div>
      )}

      {snap.id !== 'laptop' && snap.configured && (previewUrl || snap.previewError || running || (job && isReadyJob(job))) && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            📺 Live preview
          </div>
          {previewUrl ? (
            <div className="aspect-video rounded-xl overflow-hidden bg-black border border-white/8">
              <img src={previewUrl} alt={`${snap.label} preview`} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="aspect-video rounded-xl bg-slate-950 border border-white/8 flex items-center justify-center px-4 text-center text-[11px] text-slate-500">
              {snap.previewError || (running ? 'Scene ya frame aate hi yahan dikhega…' : 'Koi preview nahi')}
            </div>
          )}
          {snap.id === 'tablet' && (
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Tablet ka asli screen Termux se nahi dikh sakta (root chahiye). Yeh latest scene / video frame ki preview hai.
            </p>
          )}
          {snap.previewError && previewUrl === null && snap.id !== 'tablet' && (
            <p className="text-[10px] text-amber-300">{snap.previewError}</p>
          )}
        </div>
      )}

      {/* Also show preview on laptop when a job has a still — besides noVNC */}
      {snap.id === 'laptop' && snap.configured && (previewUrl || (running && job)) && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-slate-300">📺 Live preview</div>
          {previewUrl ? (
            <div className="aspect-video rounded-xl overflow-hidden bg-black border border-white/8">
              <img src={previewUrl} alt="Laptop preview" className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="aspect-video rounded-xl bg-slate-950 border border-white/8 flex items-center justify-center text-[11px] text-slate-500">
              Scene ya frame aate hi yahan dikhega…
            </div>
          )}
        </div>
      )}

      {ready && job && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => onDownload(snap.id, job)}
            disabled={Boolean(isDl)}
            className="w-full min-h-[40px] rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-[13px] font-bold cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-60"
          >
            <Download className="w-3.5 h-3.5" />
            {isDl
              ? isDl.progress == null
                ? 'Downloading…'
                : `Downloading… ${isDl.progress}%`
              : '⬇️ Download'}
          </button>
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            💾 Saved in {snap.savedFolder}
          </p>
          {downloadError && (
            <p className="text-[11px] text-rose-300 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="break-words">{downloadError}</span>
            </p>
          )}
        </div>
      )}
    </article>
  );
};
