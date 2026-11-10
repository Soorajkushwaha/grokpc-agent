import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { TabsNav } from './components/TabsNav';
import { LivePCScreen } from './components/LivePC/LivePCScreen';
import { AgentChatAndLogs } from './components/LivePC/AgentChatAndLogs';
import { AutomationStudio } from './components/Automation/AutomationStudio';
import { BudgetAndHealth } from './components/Budget/BudgetAndHealth';
import { OracleCodeViewer } from './components/OracleCode/OracleCodeViewer';
import { SafetyApprovalModal } from './components/Modals/SafetyApprovalModal';
import { AuthTakeoverModal } from './components/Modals/AuthTakeoverModal';
import { SettingsModal } from './components/Modals/SettingsModal';

const AppContent: React.FC = () => {
  const { activeTab } = useApp();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Application Header */}
      <Header />

      {/* Responsive Navigation Tabs (Desktop Top & Mobile Bottom) */}
      <TabsNav />

      {/* Main Tab Views */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 pb-20 md:pb-8">
        {activeTab === 'live-pc' && (
          <div className="space-y-4">
            <LivePCScreen />
            <AgentChatAndLogs />
          </div>
        )}

        {activeTab === 'automation' && <AutomationStudio />}

        {activeTab === 'budget' && <BudgetAndHealth />}

        {activeTab === 'oracle-code' && <OracleCodeViewer />}
      </main>

      {/* Interactive Global Modals */}
      <SafetyApprovalModal />
      <AuthTakeoverModal />
      <SettingsModal />
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
