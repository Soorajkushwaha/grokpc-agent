import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { TabsNav } from './components/TabsNav';
import { HomeScreen } from './screens/HomeScreen';
import { JobsScreen } from './screens/JobsScreen';
import { LiveScreen } from './screens/LiveScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const AppContent: React.FC = () => {
  const { activeTab } = useApp();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      <Header />
      <TabsNav />
      <main className="flex-1 max-w-lg w-full mx-auto p-4 pb-24 md:pb-10">
        {activeTab === 'home' && <HomeScreen />}
        {activeTab === 'jobs' && <JobsScreen />}
        {activeTab === 'live' && <LiveScreen />}
        {activeTab === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
