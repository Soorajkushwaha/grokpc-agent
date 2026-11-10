import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  QrCode,
  X,
  Lock,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Smartphone,
  Mail,
  Video,
  HardDrive,
  Sparkles,
  ArrowRight
} from 'lucide-react';

export const AuthTakeoverModal: React.FC = () => {
  const { isTakeoverModalOpen, setIsTakeoverModalOpen, addLog, setActiveTab } = useApp();
  const [activeService, setActiveService] = useState<'whatsapp' | 'google' | 'vids' | 'gdrive'>('whatsapp');
  const [whatsappVerified, setWhatsappVerified] = useState(true);

  if (!isTakeoverModalOpen) return null;

  const handleVerifySession = () => {
    setWhatsappVerified(true);
    addLog({
      type: 'system',
      title: 'Auth Takeover Confirmed',
      message: 'Persistent cookies synchronized to /data/chrome_profile. Agent is fully authorized.'
    });
    setIsTakeoverModalOpen(false);
    setActiveTab('live-pc');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-slate-900 border border-emerald-500/40 rounded-2xl shadow-2xl shadow-emerald-950/50 overflow-hidden flex flex-col font-sans">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-slate-900 border-b border-emerald-500/30 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/40">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white font-heading">
                One-Time Auth Takeover Mode
              </h3>
              <p className="text-[11px] text-emerald-300 font-mono">
                Log in ONCE to your services &bull; Cookies stored permanently in /data/chrome_profile
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsTakeoverModalOpen(false)}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Service Switcher Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-3 pt-2 gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveService('whatsapp')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold transition-all cursor-pointer ${
              activeService === 'whatsapp'
                ? 'bg-slate-900 text-emerald-400 border-t-2 border-emerald-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>WhatsApp Web</span>
          </button>

          <button
            onClick={() => setActiveService('google')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold transition-all cursor-pointer ${
              activeService === 'google'
                ? 'bg-slate-900 text-rose-400 border-t-2 border-rose-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Gmail Account</span>
          </button>

          <button
            onClick={() => setActiveService('vids')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold transition-all cursor-pointer ${
              activeService === 'vids'
                ? 'bg-slate-900 text-cyan-400 border-t-2 border-cyan-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>Google Vids</span>
          </button>

          <button
            onClick={() => setActiveService('gdrive')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-xs font-semibold transition-all cursor-pointer ${
              activeService === 'gdrive'
                ? 'bg-slate-900 text-amber-400 border-t-2 border-amber-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Google Drive</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-5 space-y-4 text-xs">
          {activeService === 'whatsapp' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
                {/* Visual QR Code Box */}
                <div className="p-3 bg-white rounded-xl shadow-lg relative flex-shrink-0">
                  <div className="w-32 h-32 flex items-center justify-center border-2 border-emerald-500">
                    <QrCode className="w-24 h-24 text-slate-900" />
                  </div>
                  <div className="absolute inset-0 bg-emerald-500/10 pointer-events-none rounded-xl" />
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">How to scan from your mobile phone:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px] leading-relaxed">
                    <li>Open <strong>WhatsApp</strong> on your mobile phone</li>
                    <li>Tap <strong>Settings</strong> &rarr; <strong>Linked Devices</strong></li>
                    <li>Tap <strong>Link a Device</strong> and point your camera to this screen (or the Live PC Screen)</li>
                    <li>Once linked, WhatsApp cookies are permanently stored on your Oracle VM!</li>
                  </ol>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 flex items-center gap-2 text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span>Session state: Authenticated. Persistent profile locked at <code className="text-cyan-300">/data/chrome_profile</code>.</span>
              </div>
            </div>
          )}

          {activeService === 'google' && (
            <div className="space-y-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
              <h4 className="text-sm font-bold text-white">Google Workspace & Gmail Login</h4>
              <p className="text-slate-300 text-xs leading-relaxed">
                Log into your Google Pro Account directly within the live Ubuntu desktop. Because Playwright runs with <code className="text-cyan-400">user_data_dir="/data/chrome_profile"</code>, you only sign in once. 2FA tokens and OAuth refresh cookies are preserved across VM reboots.
              </p>
              <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300">
                Profile Directory: <span className="text-emerald-400 font-bold">/data/chrome_profile/Default/Cookies</span>
              </div>
            </div>
          )}

          {activeService === 'vids' && (
            <div className="space-y-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
              <h4 className="text-sm font-bold text-white">Google Vids (docs.google.com/videos)</h4>
              <p className="text-slate-300 text-xs leading-relaxed">
                Google Vids requires an active Google Workspace account with Gemini Pro access. Logging in through the Live PC Screen unlocks automatic AI scene drafting, timeline creation, and video renders.
              </p>
            </div>
          )}

          {activeService === 'gdrive' && (
            <div className="space-y-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800">
              <h4 className="text-sm font-bold text-white">Google Drive Mount via Rclone</h4>
              <p className="text-slate-300 text-xs leading-relaxed">
                Run <code className="text-cyan-400 font-mono">rclone config</code> on your Oracle VM once. The included <code className="text-cyan-400 font-mono">rclone-gdrive.service</code> mounts it to <code className="text-amber-400 font-mono">/mnt/gdrive</code> automatically on boot.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-950/90 border-t border-slate-800 px-5 py-3 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-mono">
            SingletonLock active on Oracle VM
          </span>

          <button
            onClick={handleVerifySession}
            className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>Confirm & Return to PC</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
