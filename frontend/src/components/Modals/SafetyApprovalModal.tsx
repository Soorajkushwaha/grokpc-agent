import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ShieldAlert,
  Send,
  X,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  User,
  MessageSquare,
  Mail
} from 'lucide-react';

export const SafetyApprovalModal: React.FC = () => {
  const { pendingApproval, setPendingApproval } = useApp();
  const [editedContent, setEditedContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  if (!pendingApproval) return null;

  const currentContent = isEditing ? editedContent : (editedContent || pendingApproval.previewContent);

  const handleApprove = () => {
    pendingApproval.onApprove(editedContent || undefined);
  };

  const handleReject = () => {
    pendingApproval.onReject();
  };

  const isWhatsApp = pendingApproval.type === 'whatsapp';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-slate-900 border border-amber-500/50 rounded-2xl shadow-2xl shadow-amber-950/40 overflow-hidden flex flex-col font-sans">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-amber-950/80 to-slate-900 border-b border-amber-500/30 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/40">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white font-heading">
                Human-in-the-Loop Safety Approval
              </h3>
              <p className="text-[11px] text-amber-300 font-mono">
                Action requires your explicit confirmation before dispatch
              </p>
            </div>
          </div>

          <button
            onClick={handleReject}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Target Metadata Card */}
          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono">ACTION TYPE</span>
              <span className="text-amber-400 font-bold uppercase font-mono px-2 py-0.5 bg-amber-950/60 rounded border border-amber-800/40">
                {pendingApproval.type} Dispatch
              </span>
            </div>

            <div className="flex items-center gap-2 text-slate-200">
              <User className="w-4 h-4 text-cyan-400" />
              <span className="text-slate-400">Recipient:</span>
              <span className="font-bold text-white font-mono">{pendingApproval.recipient}</span>
            </div>
          </div>

          {/* Message Content Preview with Inline Edit */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-slate-300 font-semibold">Message Payload:</span>
              <button
                onClick={() => {
                  if (!isEditing) setEditedContent(pendingApproval.previewContent);
                  setIsEditing(!isEditing);
                }}
                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono text-[11px] cursor-pointer"
              >
                <Edit3 className="w-3 h-3" />
                <span>{isEditing ? 'Done Editing' : 'Edit Before Sending'}</span>
              </button>
            </div>

            {isEditing ? (
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                rows={4}
                className="w-full bg-slate-950 border border-cyan-500 rounded-xl p-3 text-xs text-white focus:outline-none font-sans"
              />
            ) : (
              <div className="p-3 bg-slate-950/90 rounded-xl border border-slate-800 text-slate-300 max-h-36 overflow-y-auto whitespace-pre-wrap font-sans">
                {currentContent}
              </div>
            )}
          </div>

          {/* Telegram bridge notice */}
          <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/40 text-[11px] text-indigo-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
            <span>Telegram Bot bridge active: You can also approve/reject from your phone Telegram app.</span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="bg-slate-950/90 border-t border-slate-800 px-5 py-3.5 flex items-center justify-end gap-2.5">
          <button
            onClick={handleReject}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer"
          >
            Reject & Discard
          </button>

          <button
            onClick={handleApprove}
            className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-950 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Approve & Dispatch Now</span>
          </button>
        </div>
      </div>
    </div>
  );
};
