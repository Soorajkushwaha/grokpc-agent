import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Send, ChevronDown, Monitor, KeyRound, ScrollText, WifiOff } from 'lucide-react';

const LOGIN_SITES = [
  { name: 'ChatGPT', url: 'chatgpt.com', why: 'Story / prompt plan (Phase 1)' },
  { name: 'Google AI Studio', url: 'aistudio.google.com', why: 'Pro voiceover — Phase 2 flag' },
  { name: 'Gemini / Flow', url: 'gemini.google.com', why: 'Veo video gen — Phase 2' },
  { name: 'Grok Imagine', url: 'grok.com', why: 'Image/video gen — Phase 2' },
  { name: 'YouTube Studio', url: 'studio.youtube.com', why: 'Upload — Phase 2' },
];

export const LiveScreen: React.FC = () => {
  const {
    novncUrl,
    config,
    health,
    liveScreenshot,
    runAgentPrompt,
    isAgentRunning,
    currentAgentTask,
    logs,
    showLogs,
    setShowLogs,
    clearLogs,
    status,
  } = useApp();
  const [prompt, setPrompt] = useState('');
  const [loginsOpen, setLoginsOpen] = useState(false);
  const connected = !config.demoMode && health.connected;

  const send = async () => {
    const t = prompt.trim();
    if (!t) return;
    setPrompt('');
    await runAgentPrompt(t);
  };

  const hasView = (connected && novncUrl) || liveScreenshot;

  return (
    <div className="space-y-3">
      <div className="screen-frame overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-slate-950/80">
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
            <Monitor className="w-3.5 h-3.5 text-cyan-400" />
            Live desktop
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              connected && novncUrl
                ? 'text-emerald-300 bg-emerald-950/60 border-emerald-700/40'
                : 'text-slate-400 bg-slate-900 border-slate-700/60'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected && novncUrl ? 'bg-emerald-400 live-dot' : 'bg-slate-500'
              }`}
            />
            {connected && novncUrl ? 'Connected' : config.demoMode ? 'Demo' : 'Offline'}
          </span>
        </div>
        <div className="relative aspect-video bg-[#05080f]">
          {connected && novncUrl ? (
            <iframe
              title="Live desktop"
              src={novncUrl}
              className="w-full h-full border-0 bg-black"
              allow="clipboard-read; clipboard-write"
            />
          ) : liveScreenshot ? (
            <img src={liveScreenshot} alt="screenshot" className="w-full h-full object-contain bg-black" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-sm px-6 text-center gap-3">
              <span className="w-12 h-12 rounded-2xl bg-slate-900 border border-white/8 flex items-center justify-center">
                {config.demoMode ? <Monitor className="w-5 h-5 text-cyan-400/70" /> : <WifiOff className="w-5 h-5 text-slate-500" />}
              </span>
              <p className="leading-relaxed text-slate-400 max-w-[18rem]">
                {config.demoMode
                  ? 'Demo — Settings me Laptop ka URL + token daalo, phir yahan noVNC dikhega.'
                  : 'noVNC URL set nahi hai, ya backend offline hai.'}
              </p>
            </div>
          )}
          {hasView && <div className="pointer-events-none absolute inset-0 rounded-b-2xl ring-1 ring-cyan-400/10" />}
        </div>
      </div>

      {(isAgentRunning || status?.currentJob) && (
        <div className="text-sm text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded-2xl px-3 py-2.5 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 step-running shrink-0" />
          {isAgentRunning ? currentAgentTask : `Job: ${status?.currentJob?.topic} (${status?.currentJob?.current_step})`}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send();
          }}
          placeholder="Browser ko bolo — jaise: YouTube kholo"
          className="field flex-1 rounded-2xl px-3.5 py-3 text-sm text-white min-h-[48px]"
        />
        <button
          onClick={() => void send()}
          disabled={!prompt.trim()}
          className="w-12 h-12 min-w-[48px] rounded-2xl bg-cyan-600 text-white disabled:opacity-40 cursor-pointer flex items-center justify-center shadow-lg shadow-cyan-900/30 hover:bg-cyan-500 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed px-0.5">
        Yeh wahi vision agent hai jo browser control karta hai. Nayi video banane ke liye Home use karo.
      </p>

      <button
        onClick={() => setLoginsOpen((v) => !v)}
        className="w-full flex items-center justify-between text-sm text-slate-300 card px-3.5 py-3 cursor-pointer min-h-[48px] hover:border-white/15 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-slate-800 text-cyan-300 flex items-center justify-center">
            <KeyRound className="w-3.5 h-3.5" />
          </span>
          Ek baar login (noVNC me)
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${loginsOpen ? 'rotate-180' : ''}`} />
      </button>
      {loginsOpen && (
        <ul className="text-[12px] text-slate-400 space-y-2.5 px-1 animate-fade-in">
          {LOGIN_SITES.map((s) => (
            <li key={s.url} className="flex flex-col">
              <span>
                <span className="text-white font-medium">{s.name}</span>
                <span className="text-slate-500"> · {s.url}</span>
              </span>
              <span className="text-slate-500">{s.why}</span>
            </li>
          ))}
          <li className="text-slate-500">Screen tab me site kholo, khud login karo. Profile save rehti hai.</li>
        </ul>
      )}

      <button
        onClick={() => setShowLogs(!showLogs)}
        className="w-full flex items-center justify-between text-sm text-slate-300 card px-3.5 py-3 cursor-pointer min-h-[48px] hover:border-white/15 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-slate-800 text-cyan-300 flex items-center justify-center">
            <ScrollText className="w-3.5 h-3.5" />
          </span>
          Details (logs)
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${showLogs ? 'rotate-180' : ''}`} />
      </button>
      {showLogs && (
        <div className="bg-slate-950/80 border border-white/8 rounded-2xl p-3 max-h-56 overflow-y-auto animate-fade-in">
          <div className="flex justify-end mb-1">
            <button onClick={clearLogs} className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">
              clear
            </button>
          </div>
          {logs.length === 0 && <p className="text-[11px] text-slate-600">Abhi koi log nahi.</p>}
          {logs.map((l) => (
            <div key={l.id} className="text-[11px] font-mono py-1.5 border-b border-slate-900 last:border-0">
              <span className="text-slate-500">{l.timestamp}</span>{' '}
              <span className={l.type === 'error' ? 'text-rose-400' : 'text-cyan-400'}>{l.title}</span>{' '}
              <span className="text-slate-400">{l.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
