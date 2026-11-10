import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { WhatsAppPayload, GoogleVidsConfig } from '../../types';
import {
  MessageSquare,
  Mail,
  Video,
  Play,
  Volume2,
  HardDrive,
  FileText,
  Send,
  Sparkles,
  CheckCircle2,
  FolderOpen,
  Sliders,
  Scissors,
  Layers,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Plus
} from 'lucide-react';

export const AutomationStudio: React.FC = () => {
  const {
    runWhatsAppFlow,
    runGmailFlow,
    runGoogleVidsFlow,
    isAgentRunning,
    currentAgentTask,
    setActiveTab
  } = useApp();

  const [activeWorkflow, setActiveWorkflow] = useState<'whatsapp' | 'gmail' | 'vids'>('vids');

  // WhatsApp form state
  const [waContact, setWaContact] = useState('Rahul Sharma');
  const [waMessage, setWaMessage] = useState('Hi Rahul! The latest tech explainer video has been generated via Google Vids + Gemini Hindi TTS and saved to Google Drive (/mnt/gdrive). Please review!');
  const [waAttachment, setWaAttachment] = useState('/mnt/gdrive/Vids_Automation/final_video.mp4');

  // Gmail form state
  const [gmailQuery, setGmailQuery] = useState('is:unread');
  const [gmailSubject, setGmailSubject] = useState('Cloud Architecture Project Review');
  const [gmailRecipient, setGmailRecipient] = useState('client.techcorp@example.com');
  const [gmailReply, setGmailReply] = useState('Hi there,\n\nI have reviewed the architecture specs. The Oracle Cloud ARM64 VM (12GB RAM) is handling our persistent Playwright browser automation smoothly within our ₹1,000 monthly budget cap.\n\nBest regards,\nPersonal AI Agent');

  // Google Vids & AI Voice state
  const [vidsConfig, setVidsConfig] = useState<GoogleVidsConfig>({
    topic: 'How Oracle Cloud ARM64 Powers 24/7 AI Browser Agents Under ₹1,000',
    aspectRatio: '16:9',
    durationSeconds: 45,
    visualStyle: 'Tech Explainer',
    voiceActor: 'Aarav (Hindi Energetic)',
    language: 'Hindi',
    speechRate: 1.0,
    voicePitch: 1.0,
    scriptText: 'Namaste dosto! Aaj ke video mein hum dekhenge kaise Oracle Cloud ka 12GB ARM64 server humare WhatsApp aur Google Vids ko 24/7 bina kisi monthly server cost ke automate karta hai.',
    burnSubtitles: true,
    saveToGdrive: true,
    destinationFolder: '/mnt/gdrive/Vids_Automation'
  });

  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  // In-browser Speech Synthesis preview for AI Voice generator
  const handlePlayVoicePreview = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(vidsConfig.scriptText);
      utterance.rate = vidsConfig.speechRate;
      utterance.pitch = vidsConfig.voicePitch;

      // Try finding Hindi or Indian English voice
      const voices = window.speechSynthesis.getVoices();
      const targetVoice = voices.find(v =>
        vidsConfig.language === 'Hindi'
          ? (v.lang.includes('hi') || v.name.toLowerCase().includes('hindi'))
          : (v.lang.includes('en-IN') || v.name.toLowerCase().includes('india'))
      );

      if (targetVoice) utterance.voice = targetVoice;

      utterance.onstart = () => setIsPlayingAudio(true);
      utterance.onend = () => setIsPlayingAudio(false);
      utterance.onerror = () => setIsPlayingAudio(false);

      window.speechSynthesis.speak(utterance);
    } else {
      setIsPlayingAudio(true);
      setTimeout(() => setIsPlayingAudio(false), 3000);
    }
  };

  const handleStopVoicePreview = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlayingAudio(false);
  };

  const handleTriggerWhatsApp = async () => {
    await runWhatsAppFlow({
      contactNameOrNumber: waContact,
      messageText: waMessage,
      attachmentPath: waAttachment
    });
    setActiveTab('live-pc');
  };

  const handleTriggerGmail = async () => {
    await runGmailFlow(gmailSubject, gmailRecipient, gmailReply);
    setActiveTab('live-pc');
  };

  const handleTriggerVids = async () => {
    await runGoogleVidsFlow(vidsConfig);
    setActiveTab('live-pc');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-12">
      {/* Workflow Navigation Selector */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => setActiveWorkflow('vids')}
          className={`p-3 rounded-xl border flex flex-col items-center sm:items-start text-center sm:text-left transition-all cursor-pointer ${
            activeWorkflow === 'vids'
              ? 'bg-cyan-950/80 border-cyan-500/70 text-white shadow-lg shadow-cyan-950/40 ring-1 ring-cyan-500/30'
              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Video className="w-5 h-5 text-cyan-400" />
            <span className="font-bold text-xs sm:text-sm font-heading hidden sm:inline">Google Vids + AI Voice</span>
          </div>
          <span className="font-bold text-xs sm:hidden">Google Vids</span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">AI Visuals + Hindi TTS + FFmpeg</span>
        </button>

        <button
          onClick={() => setActiveWorkflow('whatsapp')}
          className={`p-3 rounded-xl border flex flex-col items-center sm:items-start text-center sm:text-left transition-all cursor-pointer ${
            activeWorkflow === 'whatsapp'
              ? 'bg-emerald-950/80 border-emerald-500/70 text-white shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-500/30'
              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-5 h-5 text-emerald-400" />
            <span className="font-bold text-xs sm:text-sm font-heading hidden sm:inline">WhatsApp Web</span>
          </div>
          <span className="font-bold text-xs sm:hidden">WhatsApp</span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">Persistent Session + Drive File</span>
        </button>

        <button
          onClick={() => setActiveWorkflow('gmail')}
          className={`p-3 rounded-xl border flex flex-col items-center sm:items-start text-center sm:text-left transition-all cursor-pointer ${
            activeWorkflow === 'gmail'
              ? 'bg-rose-950/80 border-rose-500/70 text-white shadow-lg shadow-rose-950/40 ring-1 ring-rose-500/30'
              : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Mail className="w-5 h-5 text-rose-400" />
            <span className="font-bold text-xs sm:text-sm font-heading hidden sm:inline">Gmail Assistant</span>
          </div>
          <span className="font-bold text-xs sm:hidden">Gmail</span>
          <span className="text-[11px] text-slate-400 hidden sm:inline">Unread Summaries & Drafts</span>
        </button>
      </div>

      {/* WORKFLOW 1: GOOGLE VIDS + AI VOICE + FFMPEG */}
      {activeWorkflow === 'vids' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                  PIPELINE 01
                </span>
                <h2 className="text-base sm:text-lg font-bold text-white font-heading">
                  Google Vids + AI Voice + FFmpeg Pipeline
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Generates visuals on Google Vids, synthesizes Hindi/English TTS, merges via FFmpeg, and auto-saves to Google Drive.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 bg-emerald-950/50 px-2.5 py-1 rounded-lg border border-emerald-800/50">
              <HardDrive className="w-3.5 h-3.5" />
              <span>Target: /mnt/gdrive/Vids_Automation/</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Step A: Google Vids Generator */}
            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400 font-mono uppercase tracking-wider">
                  Step A: Google Vids Visuals
                </span>
                <span className="text-[10px] text-slate-500 font-mono">docs.google.com/videos</span>
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Video Topic / Prompt</label>
                <textarea
                  value={vidsConfig.topic}
                  onChange={(e) => setVidsConfig({ ...vidsConfig, topic: e.target.value })}
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Aspect Ratio</label>
                  <select
                    value={vidsConfig.aspectRatio}
                    onChange={(e) => setVidsConfig({ ...vidsConfig, aspectRatio: e.target.value as any })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-white"
                  >
                    <option value="16:9">16:9 Landscape (YouTube)</option>
                    <option value="9:16">9:16 Portrait (Reels/Shorts)</option>
                    <option value="1:1">1:1 Square</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Style Template</label>
                  <select
                    value={vidsConfig.visualStyle}
                    onChange={(e) => setVidsConfig({ ...vidsConfig, visualStyle: e.target.value as any })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-white"
                  >
                    <option value="Tech Explainer">Tech Explainer</option>
                    <option value="Business Showcase">Business Pitch</option>
                    <option value="Social Reel">Social Reel</option>
                    <option value="Cinematic Story">Cinematic Story</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Step B: Built-in Google AI Voice (TTS) Generator */}
            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400 font-mono uppercase tracking-wider">
                  Step B: Google AI Voice (TTS)
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">In-Browser Preview</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Language</label>
                  <select
                    value={vidsConfig.language}
                    onChange={(e) => setVidsConfig({ ...vidsConfig, language: e.target.value as any })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-white"
                  >
                    <option value="Hindi">Hindi (हिंदी)</option>
                    <option value="Hinglish">Hinglish</option>
                    <option value="English">Indian English</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Voice Actor</label>
                  <select
                    value={vidsConfig.voiceActor}
                    onChange={(e) => setVidsConfig({ ...vidsConfig, voiceActor: e.target.value as any })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-1.5 text-xs text-white"
                  >
                    <option value="Aarav (Hindi Energetic)">Aarav (Energetic)</option>
                    <option value="Priya (Hindi Professional)">Priya (Professional)</option>
                    <option value="Rohan (Hinglish Casual)">Rohan (Casual)</option>
                    <option value="Aditi (Indian English)">Aditi (English)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Voiceover Script</label>
                <textarea
                  value={vidsConfig.scriptText}
                  onChange={(e) => setVidsConfig({ ...vidsConfig, scriptText: e.target.value })}
                  rows={2}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* In-Browser Voice Preview Player */}
              <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-slate-300">Audition Voice:</span>
                </div>
                {isPlayingAudio ? (
                  <button
                    onClick={handleStopVoicePreview}
                    className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer"
                  >
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    onClick={handlePlayVoicePreview}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Play TTS</span>
                  </button>
                )}
              </div>
            </div>

            {/* Step C: Automated FFmpeg Pipeline on Oracle VM */}
            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-400 font-mono uppercase tracking-wider">
                  Step C: FFmpeg & Drive Export
                </span>
                <span className="text-[10px] text-purple-300 font-mono">Ubuntu 24.04 ARM64</span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-400">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vidsConfig.burnSubtitles}
                    onChange={(e) => setVidsConfig({ ...vidsConfig, burnSubtitles: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500"
                  />
                  <span>Burn stylized subtitles into video (ASS/SRT)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={vidsConfig.saveToGdrive}
                    onChange={(e) => setVidsConfig({ ...vidsConfig, saveToGdrive: e.target.checked })}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500"
                  />
                  <span>Auto-save MP4 to mounted /mnt/gdrive</span>
                </label>
              </div>

              <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 font-mono text-[10px] text-slate-300 overflow-x-auto">
                <span className="text-purple-400">$ ffmpeg</span> -i /tmp/vids.mp4 -i /tmp/tts.wav -c:v libx264 -c:a aac /mnt/gdrive/Vids_Automation/out.mp4
              </div>

              {/* Execution CTA */}
              <button
                onClick={handleTriggerVids}
                disabled={isAgentRunning}
                className="w-full py-2.5 px-3 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-cyan-950 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4 text-cyan-200" />
                <span>Execute Complete Pipeline on Oracle VM</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORKFLOW 2: WHATSAPP WEB AUTOMATOR */}
      {activeWorkflow === 'whatsapp' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                  PIPELINE 02
                </span>
                <h2 className="text-base sm:text-lg font-bold text-white font-heading">
                  WhatsApp Web Browser Automator
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Uses pre-authenticated WhatsApp Web session stored in <code className="text-cyan-400">/data/chrome_profile</code>.
              </p>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-800 font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Human Approval Guardrail Active</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Contact Name or Phone Number</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={waContact}
                    onChange={(e) => setWaContact(e.target.value)}
                    placeholder="e.g. Rahul Sharma or +919876543210"
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                  <div className="flex gap-1">
                    {['Rahul Sharma', '+91 9876543210'].map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setWaContact(c)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 rounded font-mono cursor-pointer"
                      >
                        {c.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Message Content</label>
                <textarea
                  value={waMessage}
                  onChange={(e) => setWaMessage(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Attach File from Google Drive (/mnt/gdrive)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={waAttachment}
                    onChange={(e) => setWaAttachment(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-cyan-300 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-200 uppercase font-mono tracking-wider mb-2">
                  Safety Guardrail & Pipeline Flow
                </h3>
                <ul className="space-y-2 text-xs text-slate-400">
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-emerald-950 text-emerald-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">1</span>
                    <span>Browser agent focuses search box <code className="text-cyan-400">[data-tab="3"]</code></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-emerald-950 text-emerald-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">2</span>
                    <span>Safety Modal asks you to approve or edit text on your phone</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-emerald-950 text-emerald-400 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">3</span>
                    <span>Agent attaches video file and presses Enter to dispatch</span>
                  </li>
                </ul>
              </div>

              <button
                onClick={handleTriggerWhatsApp}
                disabled={isAgentRunning || !waContact.trim()}
                className="mt-4 w-full py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                <Send className="w-4 h-4" />
                <span>Trigger WhatsApp Agent (With Safety Approval)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WORKFLOW 3: GMAIL ASSISTANT */}
      {activeWorkflow === 'gmail' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-950 text-rose-300 border border-rose-800 font-mono">
                  PIPELINE 03
                </span>
                <h2 className="text-base sm:text-lg font-bold text-white font-heading">
                  Gmail Smart Workspace Assistant
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Reads unread inbox threads, generates context-aware summaries, and drafts replies.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Search Filter Query</label>
                <input
                  type="text"
                  value={gmailQuery}
                  onChange={(e) => setGmailQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Subject</label>
                <input
                  type="text"
                  value={gmailSubject}
                  onChange={(e) => setGmailSubject(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">Recipient</label>
                <input
                  type="email"
                  value={gmailRecipient}
                  onChange={(e) => setGmailRecipient(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="space-y-3 flex flex-col justify-between">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">AI Drafted Reply</label>
                <textarea
                  value={gmailReply}
                  onChange={(e) => setGmailReply(e.target.value)}
                  rows={5}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-white font-sans"
                />
              </div>

              <button
                onClick={handleTriggerGmail}
                disabled={isAgentRunning}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-lg shadow-rose-950 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
              >
                <Mail className="w-4 h-4" />
                <span>Send Gmail Reply via Agent</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
