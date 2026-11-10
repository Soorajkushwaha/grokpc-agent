import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import {
  TabType,
  ConnectionConfig,
  OracleSystemHealth,
  BudgetMetrics,
  AgentLogEntry,
  PendingApproval,
  WhatsAppPayload,
  GoogleVidsConfig,
} from '../types';
import { apiFetch, isConfigured, loadConfig, novncIframeUrl, saveConfig, StoredConfig, wsUrl } from '../api';

interface SimulatedDesktopState {
  activeApp: 'chrome' | 'terminal' | 'vids' | 'files';
  chromeUrl: string;
  cursorPos: { x: number; y: number };
  isClicking: boolean;
  aiBoundingBox: { x: number; y: number; w: number; h: number; label: string } | null;
  whatsAppStatus: 'qr-scan' | 'connected' | 'messaging' | 'sent';
  gmailStatus: 'inbox' | 'reading' | 'drafting' | 'sent';
  vidsStatus: 'idle' | 'generating-scenes' | 'tts-sync' | 'ffmpeg-merge' | 'saved-gdrive';
  terminalLogs: string[];
  lastActionText: string;
  liveScreenshot?: string | null;
}

interface AppContextType {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  config: ConnectionConfig;
  updateConfig: (updates: Partial<ConnectionConfig>) => void;
  health: OracleSystemHealth;
  refreshHealth: () => Promise<void>;
  budget: BudgetMetrics;
  recordCost: (costInr: number, tokensUsed?: number, isGemini?: boolean) => void;
  logs: AgentLogEntry[];
  addLog: (log: Omit<AgentLogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  pendingApproval: (PendingApproval & {
    onApprove: (modifiedContent?: string) => void;
    onReject: () => void;
  }) | null;
  setPendingApproval: (approval: AppContextType['pendingApproval']) => void;
  isTakeoverModalOpen: boolean;
  setIsTakeoverModalOpen: (open: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (open: boolean) => void;
  isAgentRunning: boolean;
  currentAgentTask: string;
  wsConnected: boolean;
  liveScreenshot: string | null;
  novncUrl: string;
  simulatedDesktop: SimulatedDesktopState;
  setSimulatedDesktop: React.Dispatch<React.SetStateAction<SimulatedDesktopState>>;
  runAgentPrompt: (promptText: string) => Promise<void>;
  runWhatsAppFlow: (payload: WhatsAppPayload) => Promise<void>;
  runGmailFlow: (subject: string, recipient: string, draftBody: string) => Promise<void>;
  runGoogleVidsFlow: (vidsConfig: GoogleVidsConfig) => Promise<void>;
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
  os: 'Simulated Ubuntu 24.04',
  architecture: 'aarch64 (demo)',
  cpuUsagePercent: 14.8,
  cpuCores: 4,
  ramUsedGb: 3.4,
  ramTotalGb: 12,
  diskUsedGb: 36.4,
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
};

const AppContext = createContext<AppContextType | null>(null);

function toStored(c: ConnectionConfig): StoredConfig {
  return { backendUrl: c.backendUrl, agentToken: c.agentToken, vncUrl: c.vncUrl, demoMode: c.demoMode };
}

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const stored = loadConfig();
  const [activeTab, setActiveTab] = useState<TabType>('live-pc');
  const [config, setConfig] = useState<ConnectionConfig>(() => {
    const configured = isConfigured(stored);
    return {
      backendUrl: stored.backendUrl,
      agentToken: stored.agentToken,
      vncUrl: stored.vncUrl,
      demoMode: stored.demoMode || !configured,
    };
  });
  const [health, setHealth] = useState<OracleSystemHealth>(config.demoMode ? DEMO_HEALTH : DEFAULT_HEALTH);
  const [budget, setBudget] = useState<BudgetMetrics>(EMPTY_BUDGET);
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [pendingApproval, setPendingApproval] = useState<AppContextType['pendingApproval']>(null);
  const [isTakeoverModalOpen, setIsTakeoverModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [currentAgentTask, setCurrentAgentTask] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null);
  const [simulatedDesktop, setSimulatedDesktop] = useState<SimulatedDesktopState>({
    activeApp: 'chrome',
    chromeUrl: 'https://web.whatsapp.com',
    cursorPos: { x: 520, y: 340 },
    isClicking: false,
    aiBoundingBox: null,
    whatsAppStatus: 'connected',
    gmailStatus: 'inbox',
    vidsStatus: 'idle',
    terminalLogs: config.demoMode
      ? ['[demo] Simulated desktop — turn off Demo mode after you paste the tunnel URL and token.']
      : ['Waiting for live backend...'],
    lastActionText: 'Idle',
  });

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
      setLiveScreenshot(`data:image/png;base64,${data.screenshotPngB64}`);
    }
    if (data.pendingApproval && typeof data.pendingApproval === 'object') {
      const p = data.pendingApproval as PendingApproval;
      setPendingApproval({
        ...p,
        onApprove: (modified?: string) => void decideApproval(p.id, true, modified),
        onReject: () => void decideApproval(p.id, false),
      });
    }
    const typ = (data.type as AgentLogEntry['type']) || 'system';
    addLog({
      type: typ,
      title: String(data.title || typ),
      message: String(data.message || ''),
      coords: data.coords as AgentLogEntry['coords'],
    });
  }, [addLog]);

  const decideApproval = async (approvalId: string, approved: boolean, modified?: string) => {
    const cfg = configRef.current;
    setPendingApproval(null);
    if (cfg.demoMode || !isConfigured(cfg)) return;
    try {
      await apiFetch(toStored(cfg), '/api/approve', {
        method: 'POST',
        body: JSON.stringify({ approval_id: approvalId, approved, modified_content: modified || null }),
      });
    } catch (err) {
      addLog({ type: 'error', title: 'Approval failed', message: String(err) });
    }
  };

  const updateConfig = (updates: Partial<ConnectionConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveConfig(toStored(next));
      return next;
    });
  };

  const recordCost = (costInr: number, tokensUsed = 0, isGemini = false) => {
    if (!config.demoMode) return;
    setBudget((prev) => ({
      ...prev,
      currentSpendInr: Math.round((prev.currentSpendInr + costInr) * 100) / 100,
      deepseekTokensUsed: isGemini ? prev.deepseekTokensUsed : prev.deepseekTokensUsed + tokensUsed,
      deepseekCostInr: isGemini ? prev.deepseekCostInr : Math.round((prev.deepseekCostInr + costInr) * 100) / 100,
      geminiCallsUsed: isGemini ? prev.geminiCallsUsed + 1 : prev.geminiCallsUsed,
      geminiCostInr: isGemini ? Math.round((prev.geminiCostInr + costInr) * 100) / 100 : prev.geminiCostInr,
    }));
  };

  const clearLogs = () => setLogs([]);

  const refreshHealth = async () => {
    const cfg = configRef.current;
    if (cfg.demoMode || !isConfigured(cfg)) {
      setHealth((prev) => ({
        ...DEMO_HEALTH,
        lastPing: Date.now(),
        connected: cfg.demoMode,
        cpuUsagePercent: Math.round((12 + Math.random() * 10) * 10) / 10,
      }));
      return;
    }
    try {
      const data = await apiFetch<OracleSystemHealth>(toStored(cfg), '/api/health');
      setHealth({ ...DEFAULT_HEALTH, ...data, connected: true, lastPing: Date.now() });
      const b = await apiFetch<BudgetMetrics>(toStored(cfg), '/api/budget');
      setBudget({ ...EMPTY_BUDGET, ...b });
    } catch (err) {
      setHealth((prev) => ({ ...prev, connected: false, lastPing: Date.now() }));
      addLog({ type: 'error', title: 'Backend unreachable', message: String(err) });
    }
  };

  // WebSocket in live mode
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
    if (config.demoMode || !isConfigured(toStored(config))) return;
    const t = setInterval(() => void refreshHealth(), 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.backendUrl, config.agentToken, config.demoMode]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runWhatsAppFlow = async (payload: WhatsAppPayload) => {
    setIsAgentRunning(true);
    setCurrentAgentTask(`WhatsApp → ${payload.contactNameOrNumber}`);
    if (config.demoMode || !isConfigured(toStored(config))) {
      addLog({ type: 'action', title: 'Demo WhatsApp', message: `Pretend-send to ${payload.contactNameOrNumber}` });
      setPendingApproval({
        id: `demo-wa-${Date.now()}`,
        type: 'whatsapp',
        title: 'Demo approval (not sent)',
        recipient: payload.contactNameOrNumber,
        previewContent: payload.messageText,
        createdAt: new Date().toLocaleTimeString(),
        onApprove: async () => {
          setPendingApproval(null);
          addLog({ type: 'action', title: 'Demo sent', message: payload.messageText });
          setIsAgentRunning(false);
          setCurrentAgentTask('');
        },
        onReject: () => {
          setPendingApproval(null);
          setIsAgentRunning(false);
          setCurrentAgentTask('');
        },
      });
      return;
    }
    try {
      const res = await apiFetch<{ status: string; approval_id: string; approval: PendingApproval }>(
        toStored(config),
        '/api/whatsapp/send',
        { method: 'POST', body: JSON.stringify({ contact: payload.contactNameOrNumber, message: payload.messageText, attachment_path: payload.attachmentPath || '' }) },
      );
      addLog({ type: 'approval', title: 'Waiting for approval', message: `WhatsApp to ${payload.contactNameOrNumber}` });
      if (res.approval) {
        const p = res.approval;
        setPendingApproval({
          ...p,
          onApprove: (modified?: string) => {
            setPendingApproval(null);
            void decideApproval(p.id || res.approval_id, true, modified);
            setIsAgentRunning(false);
            setCurrentAgentTask('');
          },
          onReject: () => {
            setPendingApproval(null);
            void decideApproval(p.id || res.approval_id, false);
            setIsAgentRunning(false);
            setCurrentAgentTask('');
          },
        });
      }
    } catch (err) {
      addLog({ type: 'error', title: 'WhatsApp request failed', message: String(err) });
      setIsAgentRunning(false);
      setCurrentAgentTask('');
    }
  };

  const runGmailFlow = async (subject: string, recipient: string, draftBody: string) => {
    setIsAgentRunning(true);
    setCurrentAgentTask(`Gmail → ${recipient}`);
    if (config.demoMode || !isConfigured(toStored(config))) {
      setPendingApproval({
        id: `demo-gm-${Date.now()}`,
        type: 'gmail',
        title: 'Demo Gmail (not sent)',
        recipient,
        previewContent: draftBody,
        createdAt: new Date().toLocaleTimeString(),
        onApprove: () => {
          setPendingApproval(null);
          addLog({ type: 'action', title: 'Demo email', message: subject });
          setIsAgentRunning(false);
          setCurrentAgentTask('');
        },
        onReject: () => {
          setPendingApproval(null);
          setIsAgentRunning(false);
          setCurrentAgentTask('');
        },
      });
      return;
    }
    try {
      const res = await apiFetch<{ approval_id: string; approval: PendingApproval }>(
        toStored(config),
        '/api/gmail/send',
        { method: 'POST', body: JSON.stringify({ recipient, subject, body: draftBody }) },
      );
      const p = res.approval;
      if (p) {
        setPendingApproval({
          ...p,
          onApprove: (modified?: string) => {
            setPendingApproval(null);
            void decideApproval(p.id || res.approval_id, true, modified);
            setIsAgentRunning(false);
            setCurrentAgentTask('');
          },
          onReject: () => {
            setPendingApproval(null);
            void decideApproval(p.id || res.approval_id, false);
            setIsAgentRunning(false);
            setCurrentAgentTask('');
          },
        });
      }
    } catch (err) {
      addLog({ type: 'error', title: 'Gmail request failed', message: String(err) });
      setIsAgentRunning(false);
      setCurrentAgentTask('');
    }
  };

  const runGoogleVidsFlow = async (vidsConfig: GoogleVidsConfig) => {
    setIsAgentRunning(true);
    setCurrentAgentTask(`Video: ${vidsConfig.topic}`);
    if (config.demoMode || !isConfigured(toStored(config))) {
      addLog({ type: 'terminal', title: 'Demo FFmpeg', message: 'No real file is created in Demo mode.' });
      await sleep(800);
      setIsAgentRunning(false);
      setCurrentAgentTask('');
      return;
    }
    try {
      await apiFetch(toStored(config), '/api/video/generate', {
        method: 'POST',
        body: JSON.stringify({
          topic: vidsConfig.topic,
          script: vidsConfig.scriptText,
          language: vidsConfig.language,
          duration_seconds: vidsConfig.durationSeconds,
          use_google_vids: false,
        }),
      });
      addLog({ type: 'system', title: 'Video started', message: 'FFmpeg + gTTS pipeline running on the VM.' });
    } catch (err) {
      addLog({ type: 'error', title: 'Video failed', message: String(err) });
    } finally {
      setIsAgentRunning(false);
      setCurrentAgentTask('');
    }
  };

  const runAgentPrompt = async (promptText: string) => {
    if (!promptText.trim()) return;
    const lower = promptText.toLowerCase();
    if (lower.includes('whatsapp') || lower.startsWith('wa ')) {
      await runWhatsAppFlow({
        contactNameOrNumber: 'contact',
        messageText: promptText,
      });
      return;
    }
    if (lower.includes('video') || lower.includes('ffmpeg') || lower.includes('vids')) {
      await runGoogleVidsFlow({
        topic: promptText,
        aspectRatio: '16:9',
        durationSeconds: 15,
        visualStyle: 'Tech Explainer',
        voiceActor: 'Aarav (Hindi Energetic)',
        language: 'Hindi',
        speechRate: 1,
        voicePitch: 1,
        scriptText: promptText,
        burnSubtitles: false,
        saveToGdrive: true,
        destinationFolder: '/mnt/gdrive/Vids_Automation',
      });
      return;
    }
    setIsAgentRunning(true);
    setCurrentAgentTask(promptText);
    if (config.demoMode || !isConfigured(toStored(config))) {
      addLog({ type: 'action', title: 'Demo prompt', message: promptText });
      await sleep(600);
      addLog({ type: 'system', title: 'Demo only', message: 'Connect a backend (Settings) to run this on your Oracle VM.' });
      setIsAgentRunning(false);
      setCurrentAgentTask('');
      return;
    }
    try {
      await apiFetch(toStored(config), '/api/task', {
        method: 'POST',
        body: JSON.stringify({ prompt: promptText }),
      });
    } catch (err) {
      addLog({ type: 'error', title: 'Task failed', message: String(err) });
      setIsAgentRunning(false);
      setCurrentAgentTask('');
    }
  };

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
        recordCost,
        logs,
        addLog,
        clearLogs,
        pendingApproval,
        setPendingApproval,
        isTakeoverModalOpen,
        setIsTakeoverModalOpen,
        isSettingsModalOpen,
        setIsSettingsModalOpen,
        isAgentRunning,
        currentAgentTask,
        wsConnected,
        liveScreenshot,
        novncUrl: novncIframeUrl(toStored(config)),
        simulatedDesktop,
        setSimulatedDesktop,
        runAgentPrompt,
        runWhatsAppFlow,
        runGmailFlow,
        runGoogleVidsFlow,
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
