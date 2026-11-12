import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Send, ChevronDown } from 'lucide-react';

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

  return (
    <div className="space-y-3">
      <div className="relative bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden aspect-video">
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
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm px-6 text-center">
            {config.demoMode
              ? 'Demo — Settings me Laptop ka URL + token daalo, phir yahan noVNC dikhega.'
              : 'noVNC URL set nahi hai, ya backend offline hai.'}
          </div>
        )}
      </div>

      {(isAgentRunning || status?.currentJob) && (
        <div className="text-sm text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 rounded-xl px-3 py-2">
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
          className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-3 text-sm text-white placeholder:text-slate-600"
        />
        <button
          onClick={() => void send()}
          disabled={!prompt.trim()}
          className="px-4 rounded-xl bg-cyan-600 text-white disabled:opacity-40 cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Yeh wahi vision agent hai jo browser control karta hai. Nayi video banane ke liye Home use karo.
      </p>

      <button
        onClick={() => setLoginsOpen((v) => !v)}
        className="w-full flex items-center justify-between text-sm text-slate-300 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 cursor-pointer"
      >
        Ek baar login (noVNC me)
        <ChevronDown className={`w-4 h-4 transition ${loginsOpen ? 'rotate-180' : ''}`} />
      </button>
      {loginsOpen && (
        <ul className="text-[12px] text-slate-400 space-y-1.5 px-1">
          {LOGIN_SITES.map((s) => (
            <li key={s.url}>
              <span className="text-white font-medium">{s.name}</span>
              <span className="text-slate-500"> · {s.url}</span>
              <span className="block text-slate-500">{s.why}</span>
            </li>
          ))}
          <li className="text-slate-500">Screen tab me site kholo, khud login karo. Profile save rehti hai.</li>
        </ul>
      )}

      <button
        onClick={() => setShowLogs(!showLogs)}
        className="w-full flex items-center justify-between text-sm text-slate-300 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2.5 cursor-pointer"
      >
        Details (logs)
        <ChevronDown className={`w-4 h-4 transition ${showLogs ? 'rotate-180' : ''}`} />
      </button>
      {showLogs && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-56 overflow-y-auto">
          <div className="flex justify-end mb-1">
            <button onClick={clearLogs} className="text-[10px] text-slate-500 cursor-pointer">clear</button>
          </div>
          {logs.length === 0 && <p className="text-[11px] text-slate-600">Abhi koi log nahi.</p>}
          {logs.map((l) => (
            <div key={l.id} className="text-[11px] font-mono py-1 border-b border-slate-900">
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
