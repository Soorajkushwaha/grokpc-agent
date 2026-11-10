import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Mic,
  MicOff,
  Send,
  Sparkles,
  Bot,
  Terminal,
  Eye,
  CheckCircle,
  AlertCircle,
  ShieldAlert,
  Trash2,
  Cpu,
  Layers,
  ArrowRight,
  Filter
} from 'lucide-react';

export const AgentChatAndLogs: React.FC = () => {
  const {
    logs,
    clearLogs,
    runAgentPrompt,
    isAgentRunning,
    currentAgentTask,
    config,
    updateConfig
  } = useApp();

  const [inputPrompt, setInputPrompt] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'action' | 'vision' | 'terminal' | 'system'>('all');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Initialize Web Speech API for voice mic input
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-IN'; // Indian English / Hindi mix

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInputPrompt(transcript);
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      // Fallback voice mock
      setInputPrompt("Send WhatsApp message to Rahul saying video draft is ready on Google Drive");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      setIsListening(true);
      try {
        recognitionRef.current.start();
      } catch (err) {
        setIsListening(false);
      }
    }
  };

  const handleSendPrompt = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputPrompt.trim() || isAgentRunning) return;
    const p = inputPrompt;
    setInputPrompt('');
    runAgentPrompt(p);
  };

  const filteredLogs = logs.filter(log => {
    if (selectedFilter === 'all') return true;
    return log.type === selectedFilter;
  });

  const SUGGESTED_PROMPTS = [
    { label: 'WhatsApp Rahul', prompt: 'Send WhatsApp message to Rahul Sharma: The Google Vids draft is ready on Drive!' },
    { label: 'Google Vids Hindi', prompt: 'Open Google Vids and generate a 30s Tech Explainer with Hindi voiceover' },
    { label: 'Scan Gmail', prompt: 'Scan unread Gmail threads and summarize client invoices' },
    { label: 'Check 12GB RAM', prompt: 'Check Oracle ARM64 CPU, RAM, and Chrome profile lock status' },
  ];

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xl backdrop-blur-md flex flex-col gap-3">
      {/* Vision AI Chat Bar & Voice Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider font-heading">
              Grok Vision / Computer-Use Prompt
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
            <span>Model:</span>
            <span className="text-cyan-300 font-semibold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40">
              DeepSeek Flash (vision)
            </span>
          </div>
        </div>

        {/* Form Input */}
        <form onSubmit={handleSendPrompt} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="Tell agent: 'Send WhatsApp to Rahul', 'Make Google Vids video', 'Scan Gmail'..."
              disabled={isAgentRunning}
              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-all font-sans disabled:opacity-50 pr-10"
            />
            {isListening && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span className="text-[10px] text-red-400 font-mono">Listening...</span>
              </div>
            )}
          </div>

          {/* Voice Mic Input Button */}
          <button
            type="button"
            onClick={toggleVoiceInput}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
              isListening
                ? 'bg-red-600 text-white border-red-500 animate-pulse'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Speech Voice Input"
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          {/* Submit Action Button */}
          <button
            type="submit"
            disabled={!inputPrompt.trim() || isAgentRunning}
            className="flex items-center gap-1.5 px-3.5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md shadow-cyan-950 transition-all active:scale-95 cursor-pointer"
          >
            {isAgentRunning ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="hidden sm:inline">Executing...</span>
              </span>
            ) : (
              <>
                <span>Run</span>
                <Send className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </form>

        {/* Quick Suggestion Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 text-xs">
          <span className="text-[11px] text-slate-500 font-mono flex-shrink-0">Quick:</span>
          {SUGGESTED_PROMPTS.map((item, idx) => (
            <button
              key={idx}
              onClick={() => runAgentPrompt(item.prompt)}
              disabled={isAgentRunning}
              className="px-2.5 py-1 rounded-full bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-[11px] text-slate-300 hover:text-cyan-300 flex-shrink-0 transition-all cursor-pointer disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Step-by-Step Real-time Execution Logs */}
      <div className="border-t border-slate-800/80 pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider font-heading">
              Agent Execution Stream
            </span>
            <span className="text-[10px] font-mono text-slate-500">({logs.length} events)</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter chips */}
            <div className="flex items-center gap-1 text-[11px]">
              {(['all', 'action', 'vision', 'terminal'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setSelectedFilter(type)}
                  className={`px-2 py-0.5 rounded capitalize font-mono text-[10px] transition-all cursor-pointer ${
                    selectedFilter === type
                      ? 'bg-slate-800 text-cyan-300 border border-slate-700'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <button
              onClick={clearLogs}
              className="text-slate-500 hover:text-red-400 p-1 rounded transition-colors cursor-pointer"
              title="Clear Logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Logs Feed Container */}
        <div className="max-h-56 sm:max-h-64 overflow-y-auto space-y-1.5 pr-1 font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <div className="p-4 text-center text-slate-500 text-xs font-sans">
              No logs in this category. Give the agent a prompt above to see step-by-step actions!
            </div>
          ) : (
            filteredLogs.map(log => {
              let badgeBg = 'bg-slate-800 text-slate-300 border-slate-700';
              let Icon = CheckCircle;

              if (log.type === 'vision') {
                badgeBg = 'bg-cyan-950/70 text-cyan-400 border-cyan-800/50';
                Icon = Eye;
              } else if (log.type === 'action') {
                badgeBg = 'bg-emerald-950/70 text-emerald-400 border-emerald-800/50';
                Icon = Sparkles;
              } else if (log.type === 'terminal') {
                badgeBg = 'bg-purple-950/70 text-purple-400 border-purple-800/50';
                Icon = Terminal;
              } else if (log.type === 'approval') {
                badgeBg = 'bg-amber-950/70 text-amber-400 border-amber-800/50';
                Icon = ShieldAlert;
              } else if (log.type === 'error') {
                badgeBg = 'bg-red-950/70 text-red-400 border-red-800/50';
                Icon = AlertCircle;
              }

              return (
                <div
                  key={log.id}
                  className="p-2 rounded-lg bg-slate-950/90 border border-slate-800/80 flex items-start gap-2 hover:border-slate-700 transition-colors"
                >
                  <div className={`p-1 rounded border flex-shrink-0 ${badgeBg}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-slate-200 truncate">{log.title}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px]">
                        {log.costInr && (
                          <span className="text-emerald-400 bg-emerald-950/60 px-1 py-0.2 rounded border border-emerald-800/40">
                            +₹{log.costInr.toFixed(2)}
                          </span>
                        )}
                        <span className="text-slate-500">{log.timestamp}</span>
                      </div>
                    </div>

                    <p className="text-slate-400 text-[11px] mt-0.5 break-words font-sans">{log.message}</p>

                    {log.targetElement && (
                      <div className="mt-1 text-[10px] text-cyan-400/90 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 inline-block truncate max-w-full">
                        Selector: <span className="text-slate-300">{log.targetElement}</span>
                        {log.coords && ` (x=${log.coords.x}, y=${log.coords.y})`}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
