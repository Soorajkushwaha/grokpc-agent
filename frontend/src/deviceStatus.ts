import {
  ApiError,
  apiFetchSlot,
  fetchJobPreview,
  friendlyError,
  isConfigured,
  isNetworkError,
  type JobPreview,
  type StoredConfig,
} from './api';
import { BACKEND_OPTIONS, type BackendId, type BackendSlot, type Job } from './types';

export const SAVED_FOLDERS: Record<BackendId, string> = {
  laptop: 'Windows Videos\\GrokPC',
  tablet: 'gallery Movies/GrokPC',
  vps: 'server outputs',
};

export const ACTIVE_JOB_STATUSES = new Set([
  'running',
  'queued',
  'waiting_login',
  'waiting_credits',
]);

export const READY_JOB_STATUSES = new Set(['completed', 'success', 'waiting_approval']);

export interface TrackedJob {
  id: string;
  startedAt: number;
  topic?: string;
}

export interface DeviceSnapshot {
  id: BackendId;
  label: string;
  configured: boolean;
  online: boolean;
  tokenError: boolean;
  staleUrl: boolean;
  error: string | null;
  hostname: string;
  currentJob: Job | null;
  latestJob: Job | null;
  preview: JobPreview | null;
  previewError: string | null;
  savedFolder: string;
}

const ACTIVE_JOBS_KEY = 'grokpc_active_jobs_v1';

function emptySnap(id: BackendId, slot?: BackendSlot): DeviceSnapshot {
  return {
    id,
    label: BACKEND_OPTIONS.find((b) => b.id === id)?.label || id,
    configured: Boolean(slot && isConfigured(slot)),
    online: false,
    tokenError: false,
    staleUrl: false,
    error: null,
    hostname: '',
    currentJob: null,
    latestJob: null,
    preview: null,
    previewError: null,
    savedFolder: SAVED_FOLDERS[id],
  };
}

export function emptyDevices(): Record<BackendId, DeviceSnapshot> {
  return {
    laptop: emptySnap('laptop'),
    tablet: emptySnap('tablet'),
    vps: emptySnap('vps'),
  };
}

export function isActiveJob(job: Job | null | undefined): boolean {
  return Boolean(job && ACTIVE_JOB_STATUSES.has(job.status));
}

export function isReadyJob(job: Job | null | undefined): boolean {
  return Boolean(job && (READY_JOB_STATUSES.has(job.status) || job.final_path || job.video_path));
}

export function loadActiveJobs(): Partial<Record<BackendId, TrackedJob>> {
  try {
    const raw = localStorage.getItem(ACTIVE_JOBS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TrackedJob>;
    const out: Partial<Record<BackendId, TrackedJob>> = {};
    for (const id of ['laptop', 'tablet', 'vps'] as BackendId[]) {
      const item = parsed[id];
      if (item && typeof item.id === 'string' && item.id) {
        out[id] = {
          id: item.id,
          startedAt: Number(item.startedAt) || Date.now(),
          topic: item.topic,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveActiveJob(id: BackendId, job: TrackedJob | null): void {
  const all = loadActiveJobs();
  if (job) all[id] = job;
  else delete all[id];
  try {
    localStorage.setItem(ACTIVE_JOBS_KEY, JSON.stringify(all));
  } catch {
    /* quota / private mode */
  }
}

function pickJob(list: Job[], preferredId?: string): { current: Job | null; latest: Job | null } {
  const current = list.find((j) => isActiveJob(j)) || null;
  const preferred = preferredId ? list.find((j) => j.id === preferredId) || null : null;
  const latest = preferred || list[0] || null;
  return { current: current || (preferred && isActiveJob(preferred) ? preferred : null), latest };
}

export async function snapshotDevice(
  id: BackendId,
  slot: BackendSlot,
  preferredJobId?: string,
): Promise<DeviceSnapshot> {
  const snap = emptySnap(id, slot);
  if (!snap.configured) return snap;
  const url = slot.backendUrl;
  try {
    const health = await apiFetchSlot<Record<string, unknown>>(slot, '/api/health', {}, 8000);
    snap.online = true;
    snap.hostname = String(health.hostname || '');
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      snap.online = true;
      snap.tokenError = true;
      snap.error = friendlyError(err, id, url);
      return snap;
    }
    snap.online = false;
    snap.staleUrl = isNetworkError(err) || url.includes('trycloudflare.com');
    snap.error = friendlyError(err, id, url);
    return snap;
  }

  try {
    const r = await apiFetchSlot<{ jobs: Job[] }>(slot, '/api/jobs?limit=15', {}, 8000);
    const list = r.jobs || [];
    let preferred: Job | null = null;
    if (preferredJobId) {
      preferred = list.find((j) => j.id === preferredJobId) || null;
      if (!preferred) {
        try {
          const one = await apiFetchSlot<{ job: Job }>(
            slot,
            `/api/jobs/${encodeURIComponent(preferredJobId)}`,
            {},
            8000,
          );
          preferred = one.job;
        } catch {
          /* job gone */
        }
      } else {
        // List payload has fewer logs — fetch the full job when it's the one we are watching.
        try {
          const one = await apiFetchSlot<{ job: Job }>(
            slot,
            `/api/jobs/${encodeURIComponent(preferredJobId)}`,
            {},
            8000,
          );
          preferred = one.job;
        } catch {
          /* keep list copy */
        }
      }
    }
    const picked = pickJob(list, preferredJobId);
    snap.currentJob = picked.current;
    snap.latestJob = preferred || picked.latest;

    const previewJob = snap.currentJob || snap.latestJob;
    if (previewJob?.id) {
      try {
        snap.preview = await fetchJobPreview(slot, previewJob.id);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          snap.previewError =
            id === 'tablet'
              ? 'Live preview ke liye naya code chahiye — Termux me git pull karke start.sh chalao'
              : 'Preview abhi available nahi hai';
        }
      }
    }
  } catch (err) {
    snap.error = snap.error || friendlyError(err, id, url);
  }
  return snap;
}

export async function snapshotAllDevices(
  backends: Record<BackendId, BackendSlot>,
  preferred?: Partial<Record<BackendId, string>>,
): Promise<Record<BackendId, DeviceSnapshot>> {
  const ids: BackendId[] = ['laptop', 'tablet', 'vps'];
  const snaps = await Promise.all(
    ids.map((id) => snapshotDevice(id, backends[id] || { backendUrl: '', agentToken: '', vncUrl: '' }, preferred?.[id])),
  );
  return {
    laptop: snaps[0],
    tablet: snaps[1],
    vps: snaps[2],
  };
}

/** Used when we only have the active StoredConfig (same shape as a slot). */
export function slotFromConfig(cfg: StoredConfig, id: BackendId): BackendSlot {
  return cfg.backends?.[id] || { backendUrl: '', agentToken: '', vncUrl: '' };
}
