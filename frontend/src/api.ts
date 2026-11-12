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

export async function apiFetch<T = unknown>(
  cfg: StoredConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!isConfigured(cfg)) {
    throw new Error('Backend URL and agent token are not set');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${cfg.agentToken}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(joinUrl(cfg.backendUrl, path), { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
