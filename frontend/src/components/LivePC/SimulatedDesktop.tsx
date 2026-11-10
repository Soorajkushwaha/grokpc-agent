import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Globe,
  Terminal,
  Video,
  Folder,
  QrCode,
  Send,
  CheckCheck,
  Search,
  Paperclip,
  Maximize2,
  Lock,
  Play,
  Volume2,
  HardDrive,
  Mail,
  ExternalLink,
  Sparkles,
  MousePointer
} from 'lucide-react';

export const SimulatedDesktop: React.FC = () => {
  const { simulatedDesktop, setSimulatedDesktop, runWhatsAppFlow, runGoogleVidsFlow, isAgentRunning } = useApp();
  const [activeTab, setActiveTab] = useState<'whatsapp' | 'gmail' | 'vids' | 'drive'>('whatsapp');
  const [showTerminal, setShowTerminal] = useState(false);
  const [qrScanned, setQrScanned] = useState(true);

  return (
    <div className="relative w-full aspect-[16/10] sm:aspect-[16/9] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl select-none flex flex-col font-sans">
      {/* Top Ubuntu XFCE Desktop Panel */}
      <div className="h-6 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between px-2 text-[11px] text-slate-300 font-mono">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 font-bold text-cyan-400">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-500 inline-block" />
            <span>XFCE 4.18</span>
          </div>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400 truncate hidden sm:inline">DISPLAY=:99 (1440x900)</span>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <button
            onClick={() => setShowTerminal(!showTerminal)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded cursor-pointer ${
              showTerminal ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'hover:bg-slate-800 text-slate-400'
            }`}
          >
            <Terminal className="w-3 h-3" />
            <span>Terminal</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
            <Lock className="w-3 h-3" />
            <span className="hidden xs:inline">/data/chrome_profile [Locked]</span>
            <span className="xs:hidden">Locked</span>
          </div>
          <span className="text-slate-400 hidden xs:inline">CPU 14%</span>
          <span className="text-slate-400 hidden sm:inline">RAM 3.4G</span>
          <span className="text-slate-300 font-bold">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {/* Main Desktop Workspace */}
      <div className="relative flex-1 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden flex flex-col">
        {/* Chrome Browser Window */}
        <div className="flex-1 m-1 sm:m-2 bg-slate-900/95 rounded-lg border border-slate-700/80 shadow-xl overflow-hidden flex flex-col">
          {/* Chrome Titlebar & Browser Tabs */}
          <div className="h-8 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between px-2 gap-1">
            {/* Window control dots */}
            <div className="flex items-center gap-1.5 mr-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
            </div>

            {/* Browser Tabs */}
            <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setActiveTab('whatsapp')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t-md text-xs transition-all cursor-pointer ${
                  activeTab === 'whatsapp'
                    ? 'bg-slate-900 text-emerald-400 border-t-2 border-emerald-500 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="truncate">WhatsApp Web</span>
              </button>

              <button
                onClick={() => setActiveTab('gmail')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t-md text-xs transition-all cursor-pointer ${
                  activeTab === 'gmail'
                    ? 'bg-slate-900 text-red-400 border-t-2 border-red-500 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Mail className="w-3 h-3 text-red-400" />
                <span className="truncate">Gmail Pro</span>
              </button>

              <button
                onClick={() => setActiveTab('vids')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t-md text-xs transition-all cursor-pointer ${
                  activeTab === 'vids'
                    ? 'bg-slate-900 text-cyan-400 border-t-2 border-cyan-500 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Video className="w-3 h-3 text-cyan-400" />
                <span className="truncate">Google Vids</span>
              </button>

              <button
                onClick={() => setActiveTab('drive')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t-md text-xs transition-all cursor-pointer ${
                  activeTab === 'drive'
                    ? 'bg-slate-900 text-amber-400 border-t-2 border-amber-500 font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Folder className="w-3 h-3 text-amber-400" />
                <span className="truncate">/mnt/gdrive</span>
              </button>
            </div>

            {/* Profile Avatar Badge */}
            <div className="flex items-center gap-1 text-[11px] text-slate-400 font-mono">
              <span className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-[9px]">G</span>
              <span className="hidden sm:inline">Google Pro</span>
            </div>
          </div>

          {/* Chrome URL Address Bar */}
          <div className="h-7 bg-slate-900 border-b border-slate-800 flex items-center px-2 gap-2 text-xs text-slate-400 font-mono">
            <Lock className="w-3 h-3 text-emerald-400 flex-shrink-0" />
            <span className="truncate text-slate-300">
              {activeTab === 'whatsapp' && 'https://web.whatsapp.com'}
              {activeTab === 'gmail' && 'https://mail.google.com/mail/u/0/#inbox'}
              {activeTab === 'vids' && 'https://docs.google.com/videos/create'}
              {activeTab === 'drive' && 'file:///mnt/gdrive/Vids_Automation'}
            </span>
            <div className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Cookies Saved</span>
            </div>
          </div>

          {/* Tab Content Display */}
          <div className="relative flex-1 bg-slate-950 overflow-hidden flex flex-col">
            {/* 1. WHATSAPP WEB VIEW */}
            {activeTab === 'whatsapp' && (
              <div className="w-full h-full flex flex-col bg-[#0b141a] text-slate-200">
                {!qrScanned ? (
                  // WhatsApp QR Scan Screen Simulator
                  <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                    <div className="p-3 bg-white rounded-xl shadow-2xl mb-3">
                      <div className="w-36 h-36 border-4 border-emerald-600 p-2 flex flex-col items-center justify-center relative">
                        <QrCode className="w-28 h-28 text-slate-900" />
                        <div className="absolute inset-0 bg-emerald-500/10 animate-pulse pointer-events-none" />
                      </div>
                    </div>
                    <h3 className="text-sm font-bold text-white mb-1">To use WhatsApp on your Personal AI PC:</h3>
                    <p className="text-xs text-slate-400 max-w-sm mb-3">
                      1. Open WhatsApp on your phone &bull; 2. Tap Linked Devices &bull; 3. Point phone to this screen
                    </p>
                    <button
                      onClick={() => setQrScanned(true)}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-md transition-all cursor-pointer"
                    >
                      Simulate QR Scanned & Save Cookie
                    </button>
                  </div>
                ) : (
                  // WhatsApp Active Chat View
                  <div className="flex-1 flex overflow-hidden">
                    {/* Contacts sidebar */}
                    <div className="w-1/3 sm:w-1/4 border-r border-slate-800/80 bg-[#111b21] flex flex-col">
                      <div className="p-2 border-b border-slate-800 flex items-center gap-1.5 text-xs text-slate-400">
                        <Search className="w-3.5 h-3.5" />
                        <span className="truncate">Search chats...</span>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        <div className="p-2 bg-[#202c33] flex items-center gap-2 border-b border-slate-800/40">
                          <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xs font-bold">
                            RS
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between items-center">
                              <span className="text-xs font-semibold text-white truncate">Rahul Sharma</span>
                              <span className="text-[10px] text-emerald-400">Online</span>
                            </div>
                            <p className="text-[10px] text-slate-400 truncate">Agent: Draft approved & sent.</p>
                          </div>
                        </div>
                        <div className="p-2 hover:bg-[#202c33]/50 flex items-center gap-2 border-b border-slate-800/40 opacity-70">
                          <div className="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-white text-xs font-bold">
                            VK
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="text-xs font-medium text-slate-300 truncate">Vikas (Tech Lead)</span>
                            <p className="text-[10px] text-slate-400 truncate">Check the video draft on Drive.</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Chat Messages pane */}
                    <div className="flex-1 flex flex-col bg-[#0b141a] relative">
                      <div className="h-10 bg-[#202c33] px-3 flex items-center justify-between border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-emerald-700 flex items-center justify-center text-white text-xs font-bold">RS</div>
                          <div>
                            <p className="text-xs font-bold text-white leading-none">Rahul Sharma</p>
                            <span className="text-[9px] text-emerald-400">Authenticated Browser Context</span>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">/data/chrome_profile</span>
                      </div>

                      {/* Messages scroll */}
                      <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2 text-xs">
                        <div className="self-start max-w-[80%] bg-[#202c33] text-slate-200 p-2 rounded-lg rounded-tl-none shadow">
                          Hi! Can you share the latest automated tech explainer video?
                          <span className="text-[9px] text-slate-400 block text-right mt-0.5">19:30</span>
                        </div>

                        <div className="self-end max-w-[80%] bg-[#005c4b] text-white p-2 rounded-lg rounded-tr-none shadow">
                          Yes! The agent generated it via Google Vids + Gemini Hindi TTS. Merged via FFmpeg to /mnt/gdrive.
                          <div className="mt-1 p-1 bg-black/20 rounded flex items-center gap-1.5 text-[10px]">
                            <Video className="w-3.5 h-3.5 text-cyan-300" />
                            <span className="truncate">vids_explainer_final.mp4 (14.2 MB)</span>
                          </div>
                          <div className="flex items-center justify-end gap-1 text-[9px] text-emerald-200 mt-0.5">
                            <span>19:32</span>
                            <CheckCheck className="w-3 h-3 text-cyan-300" />
                          </div>
                        </div>
                      </div>

                      {/* Fake WhatsApp Input */}
                      <div className="h-10 bg-[#202c33] px-2 flex items-center gap-2 border-t border-slate-800">
                        <Paperclip className="w-4 h-4 text-slate-400" />
                        <div className="flex-1 bg-[#2a3942] rounded-lg px-2.5 py-1 text-xs text-slate-300 flex items-center">
                          <span className="text-slate-400">Type a message...</span>
                        </div>
                        <button className="p-1.5 bg-emerald-600 rounded-full text-white">
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. GMAIL VIEW */}
            {activeTab === 'gmail' && (
              <div className="w-full h-full flex flex-col bg-slate-900 text-slate-200 p-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-bold text-white">Gmail Workspace (Pro Account)</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800 font-mono">
                    Session Synced
                  </span>
                </div>
                <div className="mt-2 space-y-1.5 text-xs">
                  <div className="p-2 bg-slate-800/80 rounded border border-slate-700/60 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-white">Google Cloud Invoicing</span>
                      <p className="text-[11px] text-slate-400 truncate">Oracle Cloud Monthly Bill: ₹0.00 (Free Tier 12GB Active)</p>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">Today</span>
                  </div>
                  <div className="p-2 bg-slate-800/40 rounded border border-slate-700/40 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-300">DeepSeek API Notice</span>
                      <p className="text-[11px] text-slate-400 truncate">Token usage within budget. Current balance: ₹815.80 remaining</p>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">Yesterday</span>
                  </div>
                </div>
              </div>
            )}

            {/* 3. GOOGLE VIDS VIEW */}
            {activeTab === 'vids' && (
              <div className="w-full h-full flex flex-col bg-slate-950 text-slate-200 p-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold text-white">Google Vids Studio (docs.google.com/videos)</span>
                  </div>
                  <span className="text-[10px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800 font-mono">
                    AI Visual Synthesizer
                  </span>
                </div>

                {/* Video canvas preview */}
                <div className="flex-1 mt-2 bg-slate-900 rounded-lg border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden p-4">
                  <div className="w-full max-w-sm aspect-video bg-gradient-to-tr from-cyan-950 via-slate-900 to-indigo-950 rounded-lg border border-cyan-500/30 flex flex-col items-center justify-center p-3 text-center relative shadow-lg">
                    <Play className="w-8 h-8 text-cyan-400 mb-2 drop-shadow-md" />
                    <p className="text-xs font-bold text-white">Tech Explainer: Oracle ARM64 AI Computer</p>
                    <p className="text-[10px] text-cyan-300 font-mono mt-1">Audio: Gemini TTS (Hindi Energetic - Aarav)</p>

                    <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 text-[9px] font-mono text-slate-400 bg-black/40 px-2 py-0.5 rounded">
                      <Volume2 className="w-3 h-3 text-emerald-400" />
                      <span className="truncate">FFmpeg merged 1080p + Subtitles</span>
                      <span className="ml-auto text-emerald-400">Ready</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4. GOOGLE DRIVE VIEW */}
            {activeTab === 'drive' && (
              <div className="w-full h-full flex flex-col bg-slate-900 text-slate-200 p-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-white">Mounted Google Drive (/mnt/gdrive)</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800 font-mono">
                    rclone VFS Cache (1.8 TB Free)
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-slate-800/80 rounded border border-slate-700/70 flex items-center gap-2">
                    <Folder className="w-5 h-5 text-amber-400" />
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">Vids_Automation/</p>
                      <span className="text-[10px] text-slate-400">14 Videos Exported</span>
                    </div>
                  </div>
                  <div className="p-2 bg-slate-800/80 rounded border border-slate-700/70 flex items-center gap-2">
                    <HardDrive className="w-5 h-5 text-cyan-400" />
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">agent_tasks_backup.db</p>
                      <span className="text-[10px] text-slate-400">DuckDB Synced</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Terminal Drawer Overlay if opened */}
            {showTerminal && (
              <div className="absolute inset-x-0 bottom-0 h-1/2 bg-slate-950/95 border-t border-cyan-800/70 p-2 font-mono text-[10px] text-emerald-400 flex flex-col shadow-2xl backdrop-blur-sm">
                <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1 mb-1">
                  <span>bash - DISPLAY=:99 (Xvfb daemon)</span>
                  <button onClick={() => setShowTerminal(false)} className="text-slate-500 hover:text-white">✕</button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-0.5">
                  {simulatedDesktop.terminalLogs.map((log, i) => (
                    <div key={i} className="leading-tight">{log}</div>
                  ))}
                  <div className="text-cyan-400 animate-pulse">ubuntu@oracle-arm64:~$ █</div>
                </div>
              </div>
            )}

            {/* Vision AI Bounding Box overlay */}
            {simulatedDesktop.aiBoundingBox && (
              <div
                className="absolute border-2 border-cyan-400 bg-cyan-500/10 rounded pointer-events-none transition-all duration-300 z-20 flex items-start justify-end p-0.5"
                style={{
                  left: `${(simulatedDesktop.aiBoundingBox.x / 1440) * 100}%`,
                  top: `${(simulatedDesktop.aiBoundingBox.y / 900) * 100}%`,
                  width: `${(simulatedDesktop.aiBoundingBox.w / 1440) * 100}%`,
                  height: `${(simulatedDesktop.aiBoundingBox.h / 900) * 100}%`,
                }}
              >
                <span className="bg-cyan-500 text-slate-950 font-bold text-[9px] px-1 py-0.2 rounded font-mono shadow">
                  {simulatedDesktop.aiBoundingBox.label}
                </span>
              </div>
            )}

            {/* Grok Vision / Agent Animated Mouse Cursor */}
            <div
              className="absolute pointer-events-none transition-all duration-500 z-30 flex items-center justify-center"
              style={{
                left: `${(simulatedDesktop.cursorPos.x / 1440) * 100}%`,
                top: `${(simulatedDesktop.cursorPos.y / 900) * 100}%`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              <div className="relative">
                <MousePointer className="w-5 h-5 text-cyan-400 fill-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
                {simulatedDesktop.isClicking && (
                  <span className="absolute -inset-2 rounded-full border-2 border-cyan-400 animate-ping" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
