export type TabType = 'live-pc' | 'automation' | 'budget' | 'oracle-code';

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
  /** Mirrors of the active slot — existing screens use these. */
  backendUrl: string;
  agentToken: string;
  /** Optional dedicated noVNC tunnel. If empty, the app uses backendUrl/novnc/. */
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
  daysRemainingInMonth?: number;
  projectedSpendInr?: number;
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
}

export interface PendingApproval {
  id: string;
  type: 'whatsapp' | 'gmail' | 'filesystem' | 'ffmpeg' | string;
  title: string;
  recipient: string;
  previewContent: string;
  riskLevel?: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface WhatsAppPayload {
  contactNameOrNumber: string;
  messageText: string;
  attachmentPath?: string;
  scheduleTime?: string;
}

export interface GmailEmailThread {
  id: string;
  sender: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  important: boolean;
  suggestedReply?: string;
}

export interface GoogleVidsConfig {
  topic: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  durationSeconds: number;
  visualStyle: 'Tech Explainer' | 'Business Showcase' | 'Social Reel' | 'Cinematic Story';
  voiceActor: 'Aarav (Hindi Energetic)' | 'Priya (Hindi Professional)' | 'Rohan (Hinglish Casual)' | 'Aditi (Indian English)';
  language: 'Hindi' | 'Hinglish' | 'English';
  speechRate: number;
  voicePitch: number;
  scriptText: string;
  burnSubtitles: boolean;
  saveToGdrive: boolean;
  destinationFolder: string;
}
