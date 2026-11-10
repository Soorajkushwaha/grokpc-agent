import React from 'react';
import { useApp } from '../context/AppContext';
import { TabType } from '../types';
import {
  Monitor,
  Zap,
  IndianRupee,
  TerminalSquare,
  Bot
} from 'lucide-react';

interface TabItem {
  id: TabType;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const TABS: TabItem[] = [
  {
    id: 'live-pc',
    label: 'Live PC & Agent',
    shortLabel: 'Live PC',
    icon: Monitor,
  },
  {
    id: 'automation',
    label: 'Automation Studio',
    shortLabel: 'Workflows',
    icon: Zap,
    badge: '3 Flows'
  },
  {
    id: 'budget',
    label: '₹1,000 Budget & Health',
    shortLabel: 'Budget & Health',
    icon: IndianRupee,
    badge: '₹168'
  },
  {
    id: 'oracle-code',
    label: 'Oracle PC Code',
    shortLabel: 'Backend Code',
    icon: TerminalSquare,
    badge: 'Ubuntu'
  }
];

export const TabsNav: React.FC = () => {
  const { activeTab, setActiveTab } = useApp();

  return (
    <>
      {/* Desktop / Tablet Top Tabs Bar */}
      <div className="hidden md:block max-w-7xl mx-auto px-4 pt-3">
        <nav className="flex space-x-1.5 p-1 bg-slate-900/90 border border-slate-800 rounded-xl backdrop-blur-md shadow-lg">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-900/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span
                    className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Mobile Bottom Navigation Bar (Thumb friendly) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 backdrop-blur-lg border-t border-slate-800/80 px-2 py-1.5 safe-area-bottom shadow-2xl">
        <div className="flex items-center justify-around">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? 'text-cyan-400 scale-105'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className={`p-1 rounded-lg ${isActive ? 'bg-cyan-950/80 border border-cyan-800/60 shadow-sm shadow-cyan-500/20' : ''}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className={`text-[10px] mt-0.5 font-medium ${isActive ? 'font-bold text-cyan-300' : ''}`}>
                  {tab.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
