import React, { useState } from 'react';
import { ModalPortal } from './ModalPortal';
import { AlertTriangle, ShieldCheck, X } from '../lib/icons';

interface JustificationModalProps {
  citation?: {
    source_exam: string;
    year: number;
    shift?: string | null;
    paper_code?: string | null;
    question_no: string;
  };
  onSubmit: (justification: string) => Promise<void>;
  onClose: () => void;
}

export const JustificationModal: React.FC<JustificationModalProps> = ({
  citation,
  onSubmit,
  onClose,
}) => {
  const [justification, setJustification] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (justification.trim().length < 50) {
      setError('Justification must be at least 50 characters explaining why this question should be accepted.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onSubmit(justification.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to submit justification.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
        <div className="bg-white rounded-2xl w-full max-w-lg p-6 border border-slate-200 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="text-base font-bold text-slate-900">
                Originality Justification Required
              </h3>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            Policy requires written justification for questions closely matching previous-year papers.
            Your justification will be envelope-encrypted and reviewed by the Subject Moderator.
          </p>

          {citation && (
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <span className="font-bold text-slate-800">Matched Source:</span>
              <p className="text-slate-600">
                {citation.source_exam} ({citation.year})
                {citation.shift && ` — ${citation.shift}`}
                {citation.paper_code && ` [${citation.paper_code}]`}
                {' '}- Question #{citation.question_no}
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Examiner Justification (Minimum 50 characters) *
              </label>
              <textarea
                rows={4}
                required
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Explain the novelty, instructional purpose, or deliberate modification that distinguishes this question from the archived paper..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-600"
              />
              <div className="flex justify-between items-center mt-1 text-[11px] text-slate-400">
                <span>{justification.trim().length} / 50 characters minimum</span>
                {justification.trim().length >= 50 && (
                  <span className="text-emerald-600 font-semibold">Minimum length met</span>
                )}
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Cancel & Rewrite
              </button>
              <button
                type="submit"
                disabled={loading || justification.trim().length < 50}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs disabled:opacity-50 flex items-center space-x-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{loading ? 'Submitting...' : 'Submit with Justification'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
};

