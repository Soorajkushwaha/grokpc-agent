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
        <nav className="flex p-1 bg-slate-900/80 border border-white/8 rounded-2xl backdrop-blur-md">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 ${
                  on ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-900/40' : 'text-slate-400 hover:text-white hover:bg-white/5'
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

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#070b12]/90 backdrop-blur-xl border-t border-white/6 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-10px_32px_-14px_rgba(0,0,0,0.7)]">
        <div className="flex justify-around items-stretch max-w-lg mx-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex flex-col items-center justify-center min-w-[64px] min-h-[52px] py-1 px-3 rounded-2xl cursor-pointer transition-all duration-200 ${
                  on ? 'text-cyan-300 bg-cyan-400/10' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <div className="relative">
                  <Icon className={`w-5 h-5 transition-transform duration-200 ${on ? 'scale-110' : ''}`} />
                  {tab.id === 'jobs' && running > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-3.5 h-3.5 px-0.5 text-[9px] font-bold bg-cyan-500 text-white rounded-full flex items-center justify-center">
                      {running}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] mt-0.5 leading-none ${on ? 'font-bold text-cyan-300' : 'font-medium'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
