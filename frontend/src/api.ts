import type { BackendId, BackendSlot, ConnectionConfig } from './types';
import { BACKEND_OPTIONS } from './types';

const STORAGE_KEY = 'grokpc_config_v2';

export type { BackendId, BackendSlot };
export { BACKEND_OPTIONS };

export const EMPTY_SLOT: BackendSlot = { backendUrl: '', agentToken: '', vncUrl: '' };

export function emptyBackends(): Record<BackendId, BackendSlot> {
  return {
    laptop: { ...EMPTY_SLOT },
    tablet: { ...EMPTY_SLOT },
    vps: { ...EMPTY_SLOT },
  };
}

export interface StoredConfig {
  activeBackend: BackendId;
  backends: Record<BackendId, BackendSlot>;
  backendUrl: string;
  agentToken: string;
  vncUrl: string;
  demoMode: boolean;
}

export const DEFAULT_STORED: StoredConfig = {
  activeBackend: 'laptop',
  backends: emptyBackends(),
  backendUrl: '',
  agentToken: '',
  vncUrl: '',
  demoMode: true,
};

function isBackendId(v: unknown): v is BackendId {
  return v === 'laptop' || v === 'tablet' || v === 'vps';
}

export function withActive(
  partial: Pick<StoredConfig, 'activeBackend' | 'backends' | 'demoMode'>,
): StoredConfig {
  const slot = partial.backends[partial.activeBackend] || EMPTY_SLOT;
  return {
    activeBackend: partial.activeBackend,
    backends: {
      laptop: { ...EMPTY_SLOT, ...(partial.backends.laptop || {}) },
      tablet: { ...EMPTY_SLOT, ...(partial.backends.tablet || {}) },
      vps: { ...EMPTY_SLOT, ...(partial.backends.vps || {}) },
    },
    backendUrl: slot.backendUrl,
    agentToken: slot.agentToken,
    vncUrl: slot.vncUrl,
    demoMode: partial.demoMode,
  };
}

export function loadConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.backends && isBackendId(parsed.activeBackend)) {
        return withActive({
          activeBackend: parsed.activeBackend,
          backends: { ...emptyBackends(), ...parsed.backends },
          demoMode: false,
        });
      }
      const slot: BackendSlot = {
        backendUrl: parsed.backendUrl || '',
        agentToken: parsed.agentToken || '',
        vncUrl: parsed.vncUrl || '',
      };
      const backends = emptyBackends();
      backends.laptop = slot;
      return withActive({
        activeBackend: 'laptop',
        backends,
        demoMode: false,
      });
    }
    const legacy = localStorage.getItem('oracle_agent_config');
    if (legacy) {
      const old = JSON.parse(legacy);
      const backends = emptyBackends();
      backends.laptop = {
        backendUrl: old.backendUrl || '',
        agentToken: '',
        vncUrl: old.vncUrl || '',
      };
      return withActive({
        activeBackend: 'laptop',
        backends,
        demoMode: false,
      });
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_STORED, backends: emptyBackends() };
}

export function saveConfig(cfg: StoredConfig | ConnectionConfig): void {
  const active: BackendId = isBackendId((cfg as StoredConfig).activeBackend)
    ? (cfg as StoredConfig).activeBackend
    : 'laptop';
  const backends = (cfg as StoredConfig).backends
    ? { ...emptyBackends(), ...(cfg as StoredConfig).backends }
    : emptyBackends();
  backends[active] = {
    backendUrl: cfg.backendUrl,
    agentToken: cfg.agentToken,
    vncUrl: cfg.vncUrl,
  };
  const stored = withActive({
    activeBackend: active,
    backends,
    demoMode: cfg.demoMode,
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function isConfigured(cfg: Pick<StoredConfig, 'backendUrl' | 'agentToken'>): boolean {
  return Boolean(cfg.backendUrl && cfg.agentToken);
}

export function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function joinUrl(base: string, path: string): string {
  return `${trimBase(base)}${path.startsWith('/') ? path : `/${path}`}`;
}

export function wsUrl(base: string, token: string): string {
  const u = new URL(trimBase(base));
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = u.pathname.replace(/\/+$/, '') + '/ws';
  u.search = `token=${encodeURIComponent(token)}`;
  return u.toString();
}

export type NovncQuality = 'fast' | 'clear';

export interface NovncViewOpts {
  viewOnly?: boolean;
  quality?: NovncQuality;
}

/** Build the noVNC iframe/tab URL. Default is Fast (quality=2, compression=9) + Control. */
export function novncIframeUrl(
  cfg: Pick<StoredConfig, 'backendUrl' | 'agentToken' | 'vncUrl'>,
  opts: NovncViewOpts = {},
): string {
  // Prefer the token-protected backend proxy: no separate VNC password needed.
  const quality = opts.quality === 'clear' ? 6 : 2;
  const compression = opts.quality === 'clear' ? 2 : 9;
  const viewOnly = opts.viewOnly ? 1 : 0;
  const extra = `autoconnect=1&reconnect=1&resize=scale&quality=${quality}&compression=${compression}&show_dot=1&view_only=${viewOnly}`;
  if (cfg.backendUrl && cfg.agentToken) {
    const t = encodeURIComponent(cfg.agentToken);
    const wsPath = encodeURIComponent(`novnc/websockify?token=${cfg.agentToken}`);
    return `${joinUrl(cfg.backendUrl, '/novnc/vnc.html')}?token=${t}&${extra}&path=${wsPath}`;
  }
  if (cfg.vncUrl) {
    const raw = cfg.vncUrl.trim();
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}${extra}`;
  }
  return '';
}

export class ApiError extends Error {
  status: number;
  body: string;
  constructor(status: number, statusText: string, body: string) {
    const msg = status ? `${status} ${statusText}: ${body.slice(0, 300)}` : body.slice(0, 300);
    super(msg);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 0) return true;
  if (typeof TypeError !== 'undefined' && err instanceof TypeError) return true;
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return /failed to fetch|networkerror|load failed|abort|cors|timeout|network request failed/.test(msg);
}

const BACKEND_LABEL: Record<string, string> = {
  laptop: 'Laptop',
  tablet: 'Tablet',
  vps: 'VPS',
};

export function friendlyError(err: unknown, backend?: BackendId, url?: string): string {
  const label = (backend && BACKEND_LABEL[backend]) || 'Backend';
  const isCf = (url || '').includes('trycloudflare.com');
  if (isNetworkError(err)) {
    if (isCf || backend === 'tablet') {
      return `${label} URL purana ho sakta hai — Settings me naya URL daalo`;
    }
    return `${label} tak pahunch nahi paaye — Settings me URL check karo, aur device on hai na?`;
  }
  const status =
    err instanceof ApiError
      ? err.status
      : Number((/\b(\d{3})\b/.exec(String(err instanceof Error ? err.message : err)) || [])[1] || 0);
  const body = err instanceof ApiError ? err.body : String(err instanceof Error ? err.message : err);
  if (status === 401 || status === 403) {
    return `Token galat hai — Settings me ${label} ka URL aur token check karo`;
  }
  if (status === 409) {
    return 'Ek video already ban raha hai — pehle uske khatam hone ka intezaar karo';
  }
  if (status === 404) {
    return `${label} pe yeh API nahi mili — purana code ho sakta hai. Termux me git pull karke start.sh dobara chalao`;
  }
  if (status >= 500) {
    return `${label} pe error aa gaya — thodi der baad try karo`;
  }
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail;
  } catch {
    /* ignore */
  }
  const raw = err instanceof Error ? err.message : String(err);
  // Messages we already wrote in Hinglish (config / in-flight guards) — don't wrap them.
  if (raw && !/^\d{3}\b/.test(raw) && raw.length < 360) return raw;
  return `${label}: ${raw}`;
}

export function friendlyDownloadError(err: unknown, backend?: BackendId, url?: string): string {
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 404) {
    if (backend === 'tablet') {
      return 'Download nahi hua — tablet pe purana code chal raha hai. Termux me `git pull` karke start.sh dobara chalao. Video Movies/GrokPC ya outputs folder mein ho sakti hai.';
    }
    return 'Video file nahi mili — shayad abhi ban rahi hai, ya is device pe purana code hai.';
  }
  return friendlyError(err, backend, url);
}

export async function apiFetchSlot<T = unknown>(
  slot: Pick<BackendSlot, 'backendUrl' | 'agentToken'>,
  path: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<T> {
  if (!isConfigured(slot)) {
    throw new ApiError(0, 'config', 'Backend URL and agent token are not set');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${slot.agentToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (init.signal) {
    if (init.signal.aborted) ctrl.abort();
    else init.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(slot.backendUrl, path), { ...init, headers, signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, res.statusText, text);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(0, 'timeout', 'Request timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (init.signal) init.signal.removeEventListener('abort', onAbort);
  }
}

export async function apiFetch<T = unknown>(
  cfg: StoredConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!isConfigured(cfg)) {
    throw new ApiError(0, 'config', 'Backend URL and agent token are not set');
  }
  return apiFetchSlot<T>(cfg, path, init);
}

export interface JobPreview {
  ok: boolean;
  job_id: string;
  status: string;
  current_step: string;
  topic?: string;
  log_line: string;
  source: 'still' | 'video_frame' | null;
  mime?: string | null;
  image_b64?: string | null;
  has_video?: boolean;
  updated_at?: string;
  note?: string;
}

export async function fetchJobPreview(slot: Pick<BackendSlot, 'backendUrl' | 'agentToken'>, jobId: string): Promise<JobPreview> {
  return apiFetchSlot<JobPreview>(slot, `/api/jobs/${encodeURIComponent(jobId)}/preview`, {}, 15000);
}

export function previewDataUrl(preview: JobPreview | null | undefined): string | null {
  if (!preview?.image_b64) return null;
  return `data:${preview.mime || 'image/jpeg'};base64,${preview.image_b64}`;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8''|)([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"+|"+$/g, ''));
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  if (plain) return (plain[1] || plain[2] || '').trim();
  return null;
}

/** Fetch the job's final video from the active worker and trigger a browser download. */
export async function downloadJobVideo(
  cfg: StoredConfig,
  jobId: string,
  onProgress?: (percent: number | null) => void,
): Promise<string> {
  if (cfg.demoMode) {
    throw new ApiError(0, 'demo', 'Demo mode me download nahi ho sakta');
  }
  if (!isConfigured(cfg)) {
    throw new ApiError(0, 'config', 'Backend URL aur token set nahi hai');
  }
  onProgress?.(0);
  const res = await fetch(joinUrl(cfg.backendUrl, `/api/jobs/${encodeURIComponent(jobId)}/download`), {
    headers: { Authorization: `Bearer ${cfg.agentToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, res.statusText, text);
  }
  const total = Number(res.headers.get('Content-Length') || 0);
  let blob: Blob;
  if (res.body && total > 0) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(Math.min(99, Math.round((received / total) * 100)));
      }
    }
    blob = new Blob(chunks as BlobPart[], { type: res.headers.get('Content-Type') || 'video/mp4' });
  } else {
    onProgress?.(null);
    blob = await res.blob();
  }
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition')) || `GrokPC_${jobId}.mp4`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  onProgress?.(100);
  return filename;
}
