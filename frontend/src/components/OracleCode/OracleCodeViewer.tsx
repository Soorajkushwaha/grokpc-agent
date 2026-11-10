import React, { useState } from 'react';
import { BACKEND_FILES, BackendFile } from '../../data/backendCode';
import {
  FileCode,
  Copy,
  Download,
  Check,
  Terminal,
  FolderTree,
  ExternalLink,
  Sparkles,
  Server,
  PackageCheck,
  Archive
} from 'lucide-react';

export const OracleCodeViewer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<BackendFile>(BACKEND_FILES[0]);
  const [copied, setCopied] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (file: BackendFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAll = () => {
    BACKEND_FILES.forEach((file, index) => {
      setTimeout(() => {
        handleDownload(file);
      }, index * 300);
    });
  };

  const lineCount = selectedFile.content.split('\n').length;

  return (
    <div className="max-w-7xl mx-auto space-y-4 pb-12">
      {/* 3-Command Quick Deployment Guide Banner */}
      <div className="bg-gradient-to-r from-cyan-950/70 via-slate-900 to-indigo-950/70 border border-cyan-800/60 rounded-2xl p-4 sm:p-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm sm:text-base font-bold text-white font-heading">
              How to Deploy to Oracle Cloud ARM64 (Ubuntu 24.04 - 12GB RAM)
            </h2>
          </div>
          <button
            onClick={handleDownloadAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold rounded-lg shadow-md transition-all cursor-pointer active:scale-95"
          >
            <Archive className="w-4 h-4" />
            <span>Download All 5 Files</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs font-mono">
          <div className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800">
            <span className="text-cyan-400 font-bold block mb-1">1. SSH into Oracle VM</span>
            <code className="text-slate-300 block select-all">ssh ubuntu@YOUR_ORACLE_IP</code>
          </div>
          <div className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800">
            <span className="text-cyan-400 font-bold block mb-1">2. Run Setup Script</span>
            <code className="text-slate-300 block select-all">bash setup_oracle_arm64.sh</code>
          </div>
          <div className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800">
            <span className="text-cyan-400 font-bold block mb-1">3. Start Agent Daemon</span>
            <code className="text-slate-300 block select-all">sudo systemctl start oracle-agent</code>
          </div>
        </div>
      </div>

      {/* Main Code Explorer Card */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">
        {/* Left Sidebar: File Explorer */}
        <div className="w-full md:w-72 bg-slate-950/90 border-b md:border-b-0 md:border-r border-slate-800 p-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 px-2 py-1.5 mb-2 text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
              <FolderTree className="w-4 h-4 text-cyan-400" />
              <span>Backend Files ({BACKEND_FILES.length})</span>
            </div>

            <div className="space-y-1">
              {BACKEND_FILES.map(file => {
                const isSelected = selectedFile.name === file.name;
                return (
                  <button
                    key={file.name}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left p-2.5 rounded-xl text-xs transition-all cursor-pointer flex flex-col gap-0.5 ${
                      isSelected
                        ? 'bg-slate-800 text-white border border-cyan-500/50 shadow-md'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-mono font-semibold truncate ${isSelected ? 'text-cyan-300' : ''}`}>
                        {file.name}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono uppercase">
                        {file.language}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500 truncate font-sans">
                      {file.path}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400">
            <p className="font-semibold text-slate-300">Unabridged Production Code</p>
            <p className="mt-0.5">These files are generated from the real backend/ folder at build time.</p>
          </div>
        </div>

        {/* Right Pane: Code Viewer & Actions */}
        <div className="flex-1 flex flex-col bg-slate-950">
          {/* File Header Bar */}
          <div className="h-12 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode className="w-4 h-4 text-cyan-400 flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-xs sm:text-sm font-bold text-white font-mono truncate block">
                  {selectedFile.name}
                </span>
                <span className="text-[10px] text-slate-500 font-mono hidden sm:block">
                  {selectedFile.path} &bull; {lineCount} lines
                </span>
              </div>
            </div>

            {/* Action buttons: Copy & Download */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-all cursor-pointer"
                title="Copy code to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Code'}</span>
              </button>

              <button
                onClick={() => handleDownload(selectedFile)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg shadow transition-all cursor-pointer"
                title="Download file to computer"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Download</span>
              </button>
            </div>
          </div>

          {/* Description banner */}
          <div className="px-4 py-2 bg-slate-900/40 border-b border-slate-800/80 text-xs text-slate-400">
            {selectedFile.description}
          </div>

          {/* Code Viewer Body */}
          <div className="relative flex-1 overflow-x-auto max-h-[580px] p-4 text-xs font-mono text-slate-300 leading-relaxed bg-[#060910]">
            <pre className="select-all">
              <code>{selectedFile.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
