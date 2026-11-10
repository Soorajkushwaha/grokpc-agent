import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { SimulatedDesktop } from './SimulatedDesktop';
import {
  Monitor,
  Maximize2,
  RefreshCw,
  QrCode,
  Sliders,
  ExternalLink,
  Laptop,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Tv
} from 'lucide-react';

export const LivePCScreen: React.FC = () => {
  const {
    config,
    updateConfig,
    health,
    novncUrl,
    liveScreenshot,
    setIsTakeoverModalOpen,
    simulatedDesktop
  } = useApp();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  const toggleScreenMode = () => {
    updateConfig({ demoMode: !config.demoMode });
  };

  const handleReloadIframe = () => {
    setIframeKey(prev => prev + 1);
  };

  return (
    <div className={`relative bg-slate-900/80 border border-slate-800 rounded-2xl p-2.5 sm:p-3 shadow-xl backdrop-blur-md ${isFullscreen ? 'fixed inset-0 z-50 rounded-none bg-slate-950 p-4' : ''}`}>
      {/* Top Controls Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-950 border border-slate-800 text-xs font-mono">
            <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span className="text-white font-semibold">Virtual PC Viewport</span>
            <span className="text-slate-500">•</span>
            <span className="text-cyan-400 font-bold">1440x900</span>
          </div>

          {/* Mode Switcher Pill */}
          <button
            onClick={toggleScreenMode}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              config.demoMode
                ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shadow-sm'
                : 'bg-indigo-950/80 text-indigo-300 border border-indigo-800/60'
            }`}
            title="Toggle between Interactive Simulation and Live noVNC"
          >
            <Tv className="w-3.5 h-3.5" />
            <span>{config.demoMode ? 'Demo desktop' : 'Live noVNC'}</span>
          </button>
        </div>

        {/* Action Buttons: Takeover Mode, Reload, Fullscreen */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Prominent One-Time Auth Takeover Button */}
          <button
            onClick={() => setIsTakeoverModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow-md shadow-emerald-950/50 transition-all active:scale-95 cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Manual Login / Scan QR</span>
          </button>

          <button
            onClick={handleReloadIframe}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Reload Display Buffer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Toggle Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Screen Canvas Container */}
      <div className="relative w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800/80">
        {config.demoMode ? (
          <SimulatedDesktop />
        ) : (
          <div className="relative w-full aspect-[16/10] sm:aspect-[16/9] bg-slate-950 flex flex-col items-center justify-center">
            {/* Live noVNC Iframe */}
            <iframe
              key={iframeKey}
              src={novncUrl || undefined}
              title="Oracle VM noVNC Screen"
              className="w-full h-full border-0"
              allow="clipboard-read; clipboard-write; fullscreen"
            />

            {/* Offline Helper Overlay if URL unreachable */}
            <div className="absolute top-2 right-2 bg-slate-900/90 backdrop-blur-md px-2.5 py-1.5 rounded-lg border border-slate-700 text-[11px] text-slate-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Target: {novncUrl || 'set URL in Settings'}</span>
              <button
                onClick={() => updateConfig({ demoMode: true })}
                className="text-cyan-400 underline font-semibold hover:text-cyan-300 ml-1 cursor-pointer"
              >
                Switch to Simulator
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar Beneath Screen */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Profile: /data/chrome_profile</span>
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">{health.gdriveMounted ? 'Google Drive mounted' : 'Drive not mounted'}</span>
        </div>
        <div className="text-[11px] text-cyan-400">
          Agent Status: <span className="font-semibold">{simulatedDesktop.lastActionText}</span>
        </div>
      </div>
    </div>
  );
};
