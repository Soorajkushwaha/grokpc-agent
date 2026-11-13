export type TabType = 'home' | 'jobs' | 'live' | 'settings';

export type BackendId = 'laptop' | 'tablet' | 'vps';

export const BACKEND_OPTIONS: { id: BackendId; label: string; hint: string }[] = [
  { id: 'laptop', label: 'Laptop', hint: 'Windows WSL' },
  { id: 'tablet', label: 'Tablet', hint: 'Termux / Pad' },
  { id: 'vps', label: 'VPS', hint: 'Cloud Ubuntu' },
];

export interface BackendSlot {
  backendUrl: string;
  agentToken: string;
  vncUrl: string;
}

export interface ConnectionConfig {
  activeBackend: BackendId;
  backends: Record<BackendId, BackendSlot>;
  backendUrl: string;
  agentToken: string;
  vncUrl: string;
  demoMode: boolean;
}

export interface OracleSystemHealth {
  connected: boolean;
  lastPing: number;
  hostname: string;
  os: string;
  architecture: string;
  cpuUsagePercent: number;
  cpuCores: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  chromeProfileLocked: boolean;
  chromeProfileSizeMb?: number;
  gdriveMounted: boolean;
  gdriveFreeSpaceGb?: number;
  novncPortActive: boolean;
  fastapiPortActive: boolean;
  dryRun?: boolean;
  features?: Record<string, boolean>;
  phase?: number;
  currentJobId?: string | null;
}

export interface BudgetMetrics {
  monthlyCapInr: number;
  currentSpendInr: number;
  currentSpendUsd?: number;
  usdInrRate?: number;
  tokensIn?: number;
  tokensOut?: number;
  deepseekTokensUsed: number;
  deepseekCostInr: number;
  geminiCallsUsed: number;
  geminiCostInr: number;
  oracleCloudCostInr: number;
  hardLimitPauseEnabled: boolean;
  overBudget?: boolean;
  videosToday?: number;
  spendInrToday?: number;
  dailyVideoCap?: number;
  dailySpendCapInr?: number;
}

export interface AgentLogEntry {
  id: string;
  timestamp: string;
  type: 'action' | 'vision' | 'terminal' | 'approval' | 'system' | 'error';
  title: string;
  message: string;
  targetElement?: string;
  coords?: { x: number; y: number };
  costInr?: number;
  screenshotPngB64?: string;
  jobId?: string;
  step?: string;
}

export interface Channel {
  id: string;
  name: string;
  niche: string;
  language: string;
  style: string;
  youtube_url: string;
  schedule: { days: string[]; time: string };
  aspect: '16:9' | '9:16' | '1:1' | string;
  enabled: boolean;
}

export interface JobStep {
  id?: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | string;
  detail: string;
  started_at?: string;
  finished_at?: string;
  cost_inr?: number;
  seq?: number;
}

export interface Job {
  id: string;
  channel_id: string;
  topic: string;
  idea: string;
  target_minutes?: number | null;
  status: string;
  current_step: string;
  plan?: {
    title?: string;
    hook?: string;
    story?: string;
    voiceover_script?: string;
    scenes?: unknown[];
    tags?: string[];
    description?: string;
  } | null;
  voice_path?: string;
  media?: string[];
  video_path?: string;
  final_path?: string;
  youtube_id?: string;
  youtube_privacy?: string;
  provider?: string;
  error?: string;
  autopilot?: boolean;
  created_at?: string;
  updated_at?: string;
  steps: JobStep[];
  recent_logs?: { id: string; step: string; level: string; message: string; created_at: string }[];
}

export interface AgentStatus {
  ok: boolean;
  phase: number;
  features: Record<string, boolean>;
  steps: string[];
  dryRun: boolean;
  busy: boolean;
  agentBusy: boolean;
  currentJob: { id: string; topic: string; status: string; current_step: string; channel_id: string } | null;
  helper: { reachable: boolean; capcut_installed?: boolean; error?: string };
  autopilot: {
    feature: boolean;
    enabled: boolean;
    quiet_hours?: string;
    idle_seconds?: number;
    daily_video_cap?: number;
    daily_spend_cap_inr?: number;
  };
  today: { videos: number; spendInr: number; videoCap?: number; spendCapInr?: number };
  channels: number;
}

export interface RuntimeSettings {
  quiet_hours: string;
  idle_seconds: number;
  daily_video_cap: number;
  daily_spend_cap_inr: number;
  autopilot_enabled: boolean;
}

export interface StyleProfile {
  name: string;
  language: string;
  spoken_mix?: string;
  tone: string;
  thinking_style: string;
  voiceover_notes?: string;
  visual_notes?: string;
  audience?: string;
  avoid?: string;
  [key: string]: unknown;
}

export const STEP_LABELS: Record<string, string> = {
  story: 'Kahani',
  voiceover: 'Awaz',
  visuals: 'Visual',
  generate: 'Visual',
  edit: 'Edit',
  upload: 'Upload',
};

// Kept so older demo helpers type-check if referenced; messaging UI is gone.
export type PendingApproval = {
  id: string;
  type: string;
  title: string;
  recipient: string;
  previewContent: string;
  createdAt: string;
};
