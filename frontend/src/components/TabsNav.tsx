import React from 'react';
import { useApp } from '../context/AppContext';
import { TabType } from '../types';
import { Home, Clapperboard, Monitor, Settings } from 'lucide-react';

const TABS: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'jobs', label: 'Videos', icon: Clapperboard },
  { id: 'live', label: 'Screen', icon: Monitor },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const TabsNav: React.FC = () => {
  const { activeTab, setActiveTab, jobs } = useApp();
  const running = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;

  return (
    <>
      <div className="hidden md:block max-w-lg mx-auto px-4 pt-3">
        <nav className="flex p-1 bg-slate-900/90 border border-slate-800 rounded-xl">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold cursor-pointer ${
                  on ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.id === 'jobs' && running > 0 && (
                  <span className="text-[10px] bg-white/20 rounded-full px-1.5">{running}</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 px-2 py-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))]">
        <div className="flex justify-around">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center py-1 px-3 rounded-xl cursor-pointer ${on ? 'text-cyan-400' : 'text-slate-400'}`}
              >
                <div className={`relative p-1.5 rounded-lg ${on ? 'bg-cyan-950 border border-cyan-800/60' : ''}`}>
                  <Icon className="w-5 h-5" />
                  {tab.id === 'jobs' && running > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] bg-cyan-500 text-white rounded-full flex items-center justify-center">
                      {running}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] mt-0.5 ${on ? 'font-bold text-cyan-300' : ''}`}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
