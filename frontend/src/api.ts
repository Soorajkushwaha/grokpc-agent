const STORAGE_KEY = 'grokpc_config_v2';

export interface StoredConfig {
  backendUrl: string;
  agentToken: string;
  vncUrl: string;
  demoMode: boolean;
}

export const DEFAULT_STORED: StoredConfig = {
  backendUrl: '',
  agentToken: '',
  vncUrl: '',
  demoMode: true,
};

export function loadConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_STORED, ...JSON.parse(raw) };
    // migrate older key if present, but drop API keys
    const legacy = localStorage.getItem('oracle_agent_config');
    if (legacy) {
      const old = JSON.parse(legacy);
      return {
        backendUrl: old.backendUrl || '',
        agentToken: '',
        vncUrl: old.vncUrl || '',
        demoMode: old.useSimulatedDesktop !== false && !old.backendUrl,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_STORED };
}

export function saveConfig(cfg: StoredConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function isConfigured(cfg: StoredConfig): boolean {
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

export function novncIframeUrl(cfg: StoredConfig): string {
  if (cfg.vncUrl) {
    const raw = cfg.vncUrl.trim();
    if (raw.includes('token=')) return raw;
    const sep = raw.includes('?') ? '&' : '?';
    return `${raw}${sep}token=${encodeURIComponent(cfg.agentToken)}`;
  }
  if (!cfg.backendUrl) return '';
  return `${joinUrl(cfg.backendUrl, '/novnc/vnc.html')}?token=${encodeURIComponent(cfg.agentToken)}&autoconnect=1`;
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
