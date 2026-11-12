import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type {
  TabType,
  ConnectionConfig,
  OracleSystemHealth,
  BudgetMetrics,
  AgentLogEntry,
  Channel,
  Job,
  AgentStatus,
  RuntimeSettings,
  StyleProfile,
} from '../types';
import { apiFetch, isConfigured, loadConfig, novncIframeUrl, saveConfig, StoredConfig, withActive, wsUrl } from '../api';

interface AppContextType {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  config: ConnectionConfig;
  updateConfig: (updates: Partial<ConnectionConfig>) => void;
  health: OracleSystemHealth;
  refreshHealth: () => Promise<void>;
  budget: BudgetMetrics;
  status: AgentStatus | null;
  channels: Channel[];
  selectedChannelId: string;
  setSelectedChannelId: (id: string) => void;
  refreshChannels: () => Promise<void>;
  saveChannel: (ch: Partial<Channel> & { id?: string; name: string }) => Promise<void>;
  removeChannel: (id: string) => Promise<void>;
  jobs: Job[];
  refreshJobs: () => Promise<void>;
  createVideoJob: (topic: string, idea?: string) => Promise<Job | null>;
  pauseJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  approvePublish: (id: string) => Promise<void>;
  logs: AgentLogEntry[];
  addLog: (log: Omit<AgentLogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  showLogs: boolean;
  setShowLogs: (v: boolean) => void;
  isAgentRunning: boolean;
  currentAgentTask: string;
  wsConnected: boolean;
  liveScreenshot: string | null;
  novncUrl: string;
  runAgentPrompt: (promptText: string) => Promise<void>;
  settings: RuntimeSettings | null;
  saveSettings: (s: Partial<RuntimeSettings>) => Promise<void>;
  styleProfile: StyleProfile | null;
  saveStyle: (s: Partial<StyleProfile>) => Promise<void>;
}

const DEFAULT_HEALTH: OracleSystemHealth = {
  connected: false,
  lastPing: 0,
  hostname: '—',
  os: '—',
  architecture: '—',
  cpuUsagePercent: 0,
  cpuCores: 0,
  ramUsedGb: 0,
  ramTotalGb: 0,
  diskUsedGb: 0,
  diskTotalGb: 0,
  chromeProfileLocked: false,
  gdriveMounted: false,
  novncPortActive: false,
  fastapiPortActive: false,
};

const DEMO_HEALTH: OracleSystemHealth = {
  ...DEFAULT_HEALTH,
  connected: true,
  lastPing: Date.now(),
  hostname: 'demo-mode',
  os: 'Simulated',
  architecture: 'demo',
  ramUsedGb: 2.1,
  ramTotalGb: 6,
  diskUsedGb: 20,
  diskTotalGb: 100,
  novncPortActive: true,
  fastapiPortActive: true,
};

const EMPTY_BUDGET: BudgetMetrics = {
  monthlyCapInr: 1000,
  currentSpendInr: 0,
  currentSpendUsd: 0,
  deepseekTokensUsed: 0,
  deepseekCostInr: 0,
  geminiCallsUsed: 0,
  geminiCostInr: 0,
  oracleCloudCostInr: 0,
  hardLimitPauseEnabled: true,
  videosToday: 0,
  spendInrToday: 0,
  dailyVideoCap: 3,
  dailySpendCapInr: 40,
};

const DEMO_CHANNELS: Channel[] = [
  { id: 'ch1', name: 'Channel 1', niche: '', language: 'Hindi', style: 'Practical, hook pehle', youtube_url: '', schedule: { days: ['mon', 'wed', 'fri'], time: '18:00' }, aspect: '16:9', enabled: true },
  { id: 'ch2', name: 'Channel 2', niche: '', language: 'Hindi', style: 'Story-led', youtube_url: '', schedule: { days: ['tue', 'thu', 'sat'], time: '18:00' }, aspect: '16:9', enabled: true },
  { id: 'ch3', name: 'Channel 3', niche: '', language: 'Hindi', style: 'Short, punchy', youtube_url: '', schedule: { days: ['sun', 'wed'], time: '19:00' }, aspect: '9:16', enabled: true },
];

const AppContext = createContext<AppContextType | null>(null);

function toStored(c: ConnectionConfig): StoredConfig {
  const backends = c.backends || {
    laptop: { backendUrl: '', agentToken: '', vncUrl: '' },
    tablet: { backendUrl: '', agentToken: '', vncUrl: '' },
    vps: { backendUrl: '', agentToken: '', vncUrl: '' },
  };
  const active = c.activeBackend || 'laptop';
  backends[active] = { backendUrl: c.backendUrl, agentToken: c.agentToken, vncUrl: c.vncUrl };
  return withActive({ activeBackend: active, backends, demoMode: c.demoMode });
}

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const stored = loadConfig();
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [config, setConfig] = useState<ConnectionConfig>(() => {
    const configured = isConfigured(stored);
    return {
      activeBackend: stored.activeBackend,
      backends: stored.backends,
      backendUrl: stored.backendUrl,
      agentToken: stored.agentToken,
      vncUrl: stored.vncUrl,
      demoMode: !configured,
    };
  });
  const [health, setHealth] = useState<OracleSystemHealth>(config.demoMode ? DEMO_HEALTH : DEFAULT_HEALTH);
  const [budget, setBudget] = useState<BudgetMetrics>(EMPTY_BUDGET);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [channels, setChannels] = useState<Channel[]>(DEMO_CHANNELS);
  const [selectedChannelId, setSelectedChannelId] = useState('ch1');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [currentAgentTask, setCurrentAgentTask] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [styleProfile, setStyleProfile] = useState<StyleProfile | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const addLog = useCallback((log: Omit<AgentLogEntry, 'id' | 'timestamp'>) => {
    const entry: AgentLogEntry = {
      ...log,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }),
    };
    setLogs((prev) => [entry, ...prev].slice(0, 80));
  }, []);

  const ingestWsPayload = useCallback((data: Record<string, unknown>) => {
    if (data.screenshotPngB64 && typeof data.screenshotPngB64 === 'string') {
      const mime = (data as { screenshotMime?: string }).screenshotMime || 'image/png';
      setLiveScreenshot(`data:${mime};base64,${data.screenshotPngB64}`);
    }
    const typ = (data.type as AgentLogEntry['type']) || 'system';
    addLog({
      type: typ,
      title: String(data.title || typ),
      message: String(data.message || ''),
      coords: data.coords as AgentLogEntry['coords'],
      jobId: data.jobId as string | undefined,
      step: data.step as string | undefined,
    });
    if (data.jobId) {
      // A job event — refresh shortly.
      setTimeout(() => {
        const cfg = configRef.current;
        if (!cfg.demoMode && isConfigured(cfg)) {
          void apiFetch<{ jobs: Job[] }>(toStored(cfg), '/api/jobs?limit=30')
            .then((r) => setJobs(r.jobs || []))
            .catch(() => undefined);
        }
      }, 400);
    }
  }, [addLog]);

  const updateConfig = (updates: Partial<ConnectionConfig>) => {
    setConfig((prev) => {
      const backends = {
        laptop: { backendUrl: '', agentToken: '', vncUrl: '' },
        tablet: { backendUrl: '', agentToken: '', vncUrl: '' },
        vps: { backendUrl: '', agentToken: '', vncUrl: '' },
      };
      Object.assign(backends, prev.backends || {}, updates.backends || {});
      const active = updates.activeBackend || prev.activeBackend || 'laptop';
      const slotTouched =
        updates.backendUrl !== undefined ||
        updates.agentToken !== undefined ||
        updates.vncUrl !== undefined;
      if (slotTouched) {
        const base = active === prev.activeBackend
          ? { backendUrl: prev.backendUrl, agentToken: prev.agentToken, vncUrl: prev.vncUrl }
          : backends[active];
        backends[active] = {
          backendUrl: updates.backendUrl !== undefined ? updates.backendUrl : base.backendUrl,
          agentToken: updates.agentToken !== undefined ? updates.agentToken : base.agentToken,
          vncUrl: updates.vncUrl !== undefined ? updates.vncUrl : base.vncUrl,
        };
      } else {
        backends[prev.activeBackend || 'laptop'] = {
          backendUrl: prev.backendUrl,
          agentToken: prev.agentToken,
          vncUrl: prev.vncUrl,
        };
      }
      const next = withActive({
        activeBackend: active,
        backends,
        demoMode: updates.demoMode !== undefined ? updates.demoMode : prev.demoMode,
      });
      saveConfig(next);
      return next;
    });
  };

  const clearLogs = () => setLogs([]);

  const refreshChannels = useCallback(async () => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      setChannels(DEMO_CHANNELS);
      return;
    }
    try {
      const r = await apiFetch<{ channels: Channel[] }>(toStored(cfg), '/api/channels');
      const list = r.channels || [];
      setChannels(list);
      setSelectedChannelId((prev) => (list.some((c) => c.id === prev) ? prev : list[0]?.id || ''));
    } catch (err) {
      addLog({ type: 'error', title: 'Channels', message: String(err) });
    }
  }, [addLog]);

  const refreshJobs = useCallback(async () => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) return;
    try {
      const r = await apiFetch<{ jobs: Job[] }>(toStored(cfg), '/api/jobs?limit=40');
      setJobs(r.jobs || []);
    } catch {
      /* ignore transient */
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      setHealth((prev) => ({
        ...DEMO_HEALTH,
        lastPing: Date.now(),
        connected: cfg.demoMode,
      }));
      return;
    }
    try {
      const data = await apiFetch<OracleSystemHealth>(toStored(cfg), '/api/health');
      setHealth({ ...DEFAULT_HEALTH, ...data, connected: true, lastPing: Date.now() });
      const b = await apiFetch<BudgetMetrics>(toStored(cfg), '/api/budget');
      setBudget({ ...EMPTY_BUDGET, ...b });
      const s = await apiFetch<AgentStatus>(toStored(cfg), '/api/status');
      setStatus(s);
      const st = await apiFetch<{ settings: RuntimeSettings }>(toStored(cfg), '/api/settings');
      setSettings(st.settings);
      const sp = await apiFetch<{ profile: StyleProfile }>(toStored(cfg), '/api/style-profile');
      setStyleProfile(sp.profile);
    } catch (err) {
      setHealth((prev) => ({ ...prev, connected: false, lastPing: Date.now() }));
      addLog({ type: 'error', title: 'Backend unreachable', message: String(err) });
    }
  }, [addLog]);

  useEffect(() => {
    if (config.demoMode || !isConfigured(toStored(config))) {
      setWsConnected(false);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }
    const url = wsUrl(config.backendUrl, config.agentToken);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    ws.onmessage = (ev) => {
      try {
        ingestWsPayload(JSON.parse(ev.data));
      } catch {
        /* ignore */
      }
    };
    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [config.backendUrl, config.agentToken, config.demoMode, ingestWsPayload]);

  useEffect(() => {
    void refreshHealth();
    void refreshChannels();
    void refreshJobs();
    if (config.demoMode || !isConfigured(toStored(config))) return;
    const t = setInterval(() => {
      void refreshHealth();
      void refreshJobs();
    }, 8000);
    return () => clearInterval(t);
  }, [config.backendUrl, config.agentToken, config.demoMode, refreshHealth, refreshChannels, refreshJobs]);

  const createVideoJob = async (topic: string, idea = ''): Promise<Job | null> => {
    const trimmed = topic.trim();
    if (!trimmed) return null;
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      const demo: Job = {
        id: `demo-${Date.now()}`,
        channel_id: selectedChannelId,
        topic: trimmed,
        idea,
        status: 'completed',
        current_step: 'edit',
        plan: { title: trimmed, voiceover_script: trimmed, story: 'Demo plan — backend connect karo to real video banegi.' },
        final_path: '(demo — koi file nahi bani)',
        steps: [
          { name: 'story', status: 'success', detail: 'demo' },
          { name: 'voiceover', status: 'success', detail: 'demo' },
          { name: 'edit', status: 'success', detail: 'demo' },
        ],
        created_at: new Date().toISOString(),
      };
      setJobs((prev) => [demo, ...prev]);
      addLog({ type: 'system', title: 'Demo job', message: 'Settings me Laptop URL + token daalo, tab asli video banegi.' });
      setActiveTab('jobs');
      return demo;
    }
    try {
      const r = await apiFetch<{ job: Job }>(toStored(cfg), '/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ channel_id: selectedChannelId, topic: trimmed, idea }),
      });
      addLog({ type: 'system', title: 'Nayi video', message: trimmed });
      await refreshJobs();
      setActiveTab('jobs');
      return r.job;
    } catch (err) {
      addLog({ type: 'error', title: 'Job nahi bani', message: String(err) });
      return null;
    }
  };

  const jobAction = async (id: string, path: string, title: string) => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      if (path.endsWith('/cancel')) {
        setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'cancelled' } : j)));
      }
      return;
    }
    try {
      await apiFetch(toStored(cfg), path, { method: 'POST' });
      addLog({ type: 'system', title, message: id });
      await refreshJobs();
    } catch (err) {
      addLog({ type: 'error', title, message: String(err) });
    }
  };

  const runAgentPrompt = async (promptText: string) => {
    if (!promptText.trim()) return;
    setIsAgentRunning(true);
    setCurrentAgentTask(promptText);
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      addLog({ type: 'action', title: 'Demo prompt', message: promptText });
      setIsAgentRunning(false);
      setCurrentAgentTask('');
      return;
    }
    try {
      await apiFetch(toStored(cfg), '/api/task', {
        method: 'POST',
        body: JSON.stringify({ prompt: promptText }),
      });
    } catch (err) {
      addLog({ type: 'error', title: 'Task failed', message: String(err) });
      setIsAgentRunning(false);
      setCurrentAgentTask('');
    }
  };

  const saveChannel = async (ch: Partial<Channel> & { id?: string; name: string }) => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      if (ch.id) {
        setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, ...ch } as Channel : c)));
      } else {
        const id = `ch-demo-${Date.now()}`;
        setChannels((prev) => [...prev, { id, niche: '', language: 'Hindi', style: '', youtube_url: '', schedule: { days: ['mon'], time: '18:00' }, aspect: '16:9', enabled: true, ...ch, name: ch.name }]);
      }
      return;
    }
    try {
      if (ch.id && channels.some((c) => c.id === ch.id)) {
        await apiFetch(toStored(cfg), `/api/channels/${ch.id}`, { method: 'PUT', body: JSON.stringify(ch) });
      } else {
        await apiFetch(toStored(cfg), '/api/channels', { method: 'POST', body: JSON.stringify(ch) });
      }
      await refreshChannels();
    } catch (err) {
      addLog({ type: 'error', title: 'Channel', message: String(err) });
    }
  };

  const removeChannel = async (id: string) => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      setChannels((prev) => prev.filter((c) => c.id !== id));
      return;
    }
    try {
      await apiFetch(toStored(cfg), `/api/channels/${id}`, { method: 'DELETE' });
      await refreshChannels();
    } catch (err) {
      addLog({ type: 'error', title: 'Channel delete', message: String(err) });
    }
  };

  const saveSettingsFn = async (s: Partial<RuntimeSettings>) => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      setSettings((prev) => ({ ...(prev || { quiet_hours: '23:00-07:00', idle_seconds: 900, daily_video_cap: 3, daily_spend_cap_inr: 40, autopilot_enabled: false }), ...s }));
      return;
    }
    try {
      const r = await apiFetch<{ settings: RuntimeSettings }>(toStored(cfg), '/api/settings', {
        method: 'PUT',
        body: JSON.stringify(s),
      });
      setSettings(r.settings);
    } catch (err) {
      addLog({ type: 'error', title: 'Settings', message: String(err) });
    }
  };

  const saveStyleFn = async (s: Partial<StyleProfile>) => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      setStyleProfile((prev) => ({ ...(prev as StyleProfile), ...s } as StyleProfile));
      return;
    }
    try {
      const r = await apiFetch<{ profile: StyleProfile }>(toStored(cfg), '/api/style-profile', {
        method: 'PUT',
        body: JSON.stringify(s),
      });
      setStyleProfile(r.profile);
    } catch (err) {
      addLog({ type: 'error', title: 'Style', message: String(err) });
    }
  };

  // Clear "agent running" when a finished log arrives after some time
  useEffect(() => {
    if (!isAgentRunning) return;
    const last = logs[0];
    if (last && (last.title === 'Agent finished' || last.title === 'Task failed')) {
      setIsAgentRunning(false);
      setCurrentAgentTask('');
    }
  }, [logs, isAgentRunning]);

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        config,
        updateConfig,
        health,
        refreshHealth,
        budget,
        status,
        channels,
        selectedChannelId,
        setSelectedChannelId,
        refreshChannels,
        saveChannel,
        removeChannel,
        jobs,
        refreshJobs,
        createVideoJob,
        pauseJob: (id) => jobAction(id, `/api/jobs/${id}/pause`, 'Paused'),
        resumeJob: (id) => jobAction(id, `/api/jobs/${id}/resume`, 'Resumed'),
        cancelJob: (id) => jobAction(id, `/api/jobs/${id}/cancel`, 'Cancelled'),
        approvePublish: (id) => jobAction(id, `/api/jobs/${id}/approve-publish`, 'Publish'),
        logs,
        addLog,
        clearLogs,
        showLogs,
        setShowLogs,
        isAgentRunning,
        currentAgentTask,
        wsConnected,
        liveScreenshot,
        novncUrl: novncIframeUrl(toStored(config)),
        runAgentPrompt,
        settings,
        saveSettings: saveSettingsFn,
        styleProfile,
        saveStyle: saveStyleFn,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within an AppProvider');
  return context;
};
