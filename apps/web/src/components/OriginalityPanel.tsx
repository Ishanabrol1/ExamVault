import React, { useState, useEffect, useRef } from 'react';
import { apiRequest } from '../lib/api-client';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Info,
  CheckCircle2,
  FileText,
  ChevronDown,
  ChevronUp,
} from '../lib/icons';

export interface OriginalityMatch {
  sourceType: 'PAST_PAPER' | 'BANK';
  matchType: 'EXACT' | 'NEAR' | 'NUMBERS_CHANGED' | 'OPTIONS_MATCH' | 'SEMANTIC';
  riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXACT';
  overallScore?: number;
  citation?: {
    source_exam: string;
    year: number;
    shift?: string | null;
    paper_code?: string | null;
    question_no: string;
  };
  matchedText?: string;
  spans?: { start: number; end: number; text: string }[];
  bankMessage?: string;
}

export interface OriginalityResult {
  riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXACT';
  matches: OriginalityMatch[];
  checkedAt: string;
  advisoryNote?: string;
}

interface OriginalityPanelProps {
  stem: string;
  options: { label: string; text: string }[];
  questionType: string;
  language: string;
  subjectName?: string;
  onJustificationNeeded?: (citation?: any) => void;
  onRequestSubmitWithJustification?: (justification: string, citation?: any) => void;
}

export const OriginalityPanel: React.FC<OriginalityPanelProps> = ({
  stem,
  options,
  questionType,
  language,
  subjectName,
  onJustificationNeeded,
}) => {
  const [result, setResult] = useState<OriginalityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkerUnavailable, setCheckerUnavailable] = useState(false);
  const [lastCheckedStem, setLastCheckedStem] = useState('');
  const [expanded, setExpanded] = useState(false);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const runCheck = async (_isManual = false) => {
    if (!stem.trim() || stem.trim().length < 10) {
      setResult(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    setCheckerUnavailable(false);

    try {
      const opts = options.map((o) => o.text).filter((t) => t.trim().length > 0);
      const res = await apiRequest<{ success: boolean; data: OriginalityResult }>('/originality/check-draft', {
        method: 'POST',
        body: JSON.stringify({
          stem: stem.trim(),
          options: opts,
          type: questionType,
          language: language.toLowerCase(),
          subject: subjectName || '',
        }),
      });

      setResult(res.data);
      setLastCheckedStem(stem.trim());
      setCheckerUnavailable(false);

      // Check if highest match is past-paper HIGH/EXACT
      const topPastPaper = res.data?.matches?.find(
        (m) => m.sourceType === 'PAST_PAPER' && (m.riskLevel === 'HIGH' || m.riskLevel === 'EXACT'),
      );
      if (topPastPaper && onJustificationNeeded) {
        onJustificationNeeded(topPastPaper.citation);
      }
    } catch (err: any) {
      if (err.status === 429) {
        setError('Rate limit exceeded (max 30 checks/minute). Pausing live checks.');
      } else {
        setCheckerUnavailable(true);
        setError(err.message || 'Originality checker currently unreachable.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Debounced live check (800ms) after typing pauses
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (!stem.trim() || stem.trim().length < 15) {
      return;
    }

    if (stem.trim() === lastCheckedStem) {
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      runCheck(false);
    }, 800);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [stem, options, questionType, language]);

  // Percentage value calculation
  const getPercentage = () => {
    if (!result) return 0;
    switch (result.riskLevel) {
      case 'EXACT':
        return 100;
      case 'HIGH':
        return 85;
      case 'MEDIUM':
        return 60;
      case 'LOW':
        return 30;
      default:
        return 0;
    }
  };

  const percentage = getPercentage();
  const matchCount = result?.matches?.length ?? 0;

  // Visual styling based on risk percentage
  const getStatusColorConfig = () => {
    if (loading) {
      return {
        bg: 'bg-blue-50/70 border-blue-200 text-blue-800',
        badge: 'bg-blue-100 text-blue-800 border-blue-200',
        icon: <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />,
        text: 'Checking originality...',
      };
    }
    if (checkerUnavailable) {
      return {
        bg: 'bg-amber-50/80 border-amber-200 text-amber-900',
        badge: 'bg-amber-100 text-amber-900 border-amber-300',
        icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
        text: 'Checker offline (advisory only)',
      };
    }
    if (!result || !stem.trim() || stem.trim().length < 10) {
      return {
        bg: 'bg-slate-50 border-slate-200 text-slate-700',
        badge: 'bg-slate-200 text-slate-700 border-slate-300',
        icon: <ShieldCheck className="w-4 h-4 text-slate-400" />,
        text: '0% Duplicate Risk',
      };
    }
    if (result.riskLevel === 'EXACT') {
      return {
        bg: 'bg-red-50/90 border-red-300 text-red-900',
        badge: 'bg-red-600 text-white font-bold',
        icon: <ShieldAlert className="w-4 h-4 text-red-600" />,
        text: `${percentage}% Duplicate Match`,
      };
    }
    if (result.riskLevel === 'HIGH') {
      return {
        bg: 'bg-orange-50/90 border-orange-300 text-orange-950',
        badge: 'bg-orange-600 text-white font-bold',
        icon: <AlertTriangle className="w-4 h-4 text-orange-600" />,
        text: `${percentage}% Similarity (High Risk)`,
      };
    }
    if (result.riskLevel === 'MEDIUM') {
      return {
        bg: 'bg-amber-50/90 border-amber-300 text-amber-950',
        badge: 'bg-amber-500 text-white font-bold',
        icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
        text: `${percentage}% Similarity (Medium)`,
      };
    }
    if (result.riskLevel === 'LOW') {
      return {
        bg: 'bg-blue-50/70 border-blue-200 text-blue-900',
        badge: 'bg-blue-100 text-blue-800 font-semibold',
        icon: <Info className="w-4 h-4 text-blue-600" />,
        text: `${percentage}% Similarity (Low)`,
      };
    }
    return {
      bg: 'bg-emerald-50/80 border-emerald-200 text-emerald-900',
      badge: 'bg-emerald-600 text-white font-bold',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
      text: '0% Match (Original)',
    };
  };

  const statusConfig = getStatusColorConfig();

  const getMatchTypeBadge = (type: string) => {
    switch (type) {
      case 'EXACT':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-100 text-red-800">Exact Match</span>;
      case 'NUMBERS_CHANGED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-orange-100 text-orange-800">Numbers Changed</span>;
      case 'OPTIONS_MATCH':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-100 text-purple-800">Options Reordered</span>;
      case 'NEAR':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800">Near Duplicate</span>;
      case 'SEMANTIC':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-100 text-indigo-800">Semantic Similar</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700">{type}</span>;
    }
  };

  return (
    <div className="w-full transition-all">
      {/* ── Compact Inline Bar Directly Above the Box ── */}
      <div
        className={`flex items-center justify-between px-3.5 py-2 rounded-xl border text-xs shadow-xs transition-all ${
          statusConfig.bg
        } ${matchCount > 0 ? 'cursor-pointer hover:shadow-sm' : ''}`}
        onClick={() => {
          if (matchCount > 0 || error || checkerUnavailable) {
            setExpanded(!expanded);
          }
        }}
      >
        {/* Left Side: Status & Risk Percentage */}
        <div className="flex items-center space-x-2.5 truncate">
          <div className="flex-shrink-0">{statusConfig.icon}</div>
          <div className="flex items-center space-x-2 truncate">
            <span className="font-semibold text-slate-900">Originality Check:</span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] shadow-2xs ${statusConfig.badge}`}>
              {statusConfig.text}
            </span>
            {matchCount > 0 && (
              <span className="text-[11px] text-slate-600 font-medium hidden sm:inline">
                ({matchCount} {matchCount === 1 ? 'match' : 'matches'})
              </span>
            )}
          </div>
        </div>

        {/* Right Side: Quick Action & Expand Toggle */}
        <div className="flex items-center space-x-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Quick Manual Re-check Button */}
          <button
            type="button"
            title="Re-check originality now"
            onClick={() => runCheck(true)}
            disabled={loading || !stem.trim()}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-black/5 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-red-600' : ''}`} />
          </button>

          {/* Toggle Details Button (Enabled when matches or errors exist) */}
          {(matchCount > 0 || error || checkerUnavailable) && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white/80 hover:bg-white text-slate-800 border border-slate-300 shadow-2xs transition-colors"
            >
              <span>{expanded ? 'Hide Details' : `Details (${matchCount})`}</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* ── Expandable Details Drawer (Shows when clicked) ── */}
      {expanded && (
        <div className="mt-2 p-4 rounded-xl bg-white border border-slate-200 shadow-md space-y-3 animate-fadeIn text-xs">
          {/* Advisory guidance */}
          <div className="flex items-start justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center space-x-2 text-[11px] text-slate-600">
              <Info className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <span>
                <strong>Advisory Check:</strong> Live feedback updates as you pause typing. The server strictly enforces approval policies on submit.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-slate-400 hover:text-slate-700 text-xs font-semibold px-2 py-0.5 rounded hover:bg-slate-100"
            >
              Close
            </button>
          </div>

          {/* Rewrite alert banner for EXACT / HIGH */}
          {(result?.riskLevel === 'EXACT' || result?.riskLevel === 'HIGH') && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-950 space-y-1">
              <p className="font-bold flex items-center space-x-1.5 text-xs text-red-800">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span>Rewrite Recommended</span>
              </p>
              <p className="text-[11px] text-red-900 leading-relaxed">
                This question closely matches a previous-year question. Rewrite the stem, modify the context, or provide a written justification before submission.
              </p>
            </div>
          )}

          {/* Checker Unavailable Warning */}
          {checkerUnavailable && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-[11px]">
                Originality checker is currently unavailable. You may continue writing and saving drafts; the server will screen upon submission.
              </p>
            </div>
          )}

          {/* Matches List */}
          {result && result.matches.length > 0 ? (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                Detected Matches ({result.matches.length}):
              </span>

              {result.matches.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 rounded-lg border text-xs space-y-1.5 transition-all ${
                    m.riskLevel === 'EXACT' || m.riskLevel === 'HIGH'
                      ? 'bg-red-50/40 border-red-200'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 flex items-center space-x-1.5">
                      <FileText className="w-3.5 h-3.5 text-slate-500" />
                      <span>{m.sourceType === 'PAST_PAPER' ? 'Previous-Year Paper' : 'Question Bank'}</span>
                    </span>
                    <div className="flex items-center space-x-1.5">
                      {getMatchTypeBadge(m.matchType)}
                      {m.overallScore !== undefined && (
                        <span className="font-mono text-[10px] font-bold text-slate-600">
                          {Math.round(m.overallScore * 100)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* PAST_PAPER Citation */}
                  {m.sourceType === 'PAST_PAPER' && m.citation && (
                    <div className="p-2 rounded bg-white border border-slate-200 text-[11px]">
                      <span className="font-bold text-slate-900">
                        {m.citation.source_exam} ({m.citation.year})
                        {m.citation.shift && ` — ${m.citation.shift}`}
                        {m.citation.paper_code && ` [${m.citation.paper_code}]`}
                      </span>
                      <span className="text-slate-500 font-mono ml-2">Q#{m.citation.question_no}</span>
                    </div>
                  )}

                  {/* Overlapping text snippet for PAST_PAPER */}
                  {m.sourceType === 'PAST_PAPER' && m.matchedText && (
                    <div className="text-[11px] text-slate-700 bg-white/80 p-2 rounded border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 block mb-0.5">Matched Text:</span>
                      <p className="italic line-clamp-2">"{m.matchedText}"</p>
                    </div>
                  )}

                  {/* Overlapping Spans */}
                  {m.spans && m.spans.length > 0 && (
                    <div className="flex flex-wrap gap-1 items-center pt-0.5">
                      <span className="text-[10px] font-bold text-slate-500 mr-1">Overlaps:</span>
                      {m.spans.slice(0, 4).map((span, sIdx) => (
                        <span key={sIdx} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono text-[10px]">
                          "{span.text}"
                        </span>
                      ))}
                    </div>
                  )}

                  {/* BANK matches: strictly generic privacy message */}
                  {m.sourceType === 'BANK' && (
                    <p className="text-[11px] text-slate-600 italic">
                      {m.bankMessage || 'Possible duplicate in the internal question bank.'} (Bank content is confidential)
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-center space-y-1">
              <CheckCircle2 className="w-5 h-5 mx-auto text-emerald-600" />
              <p className="text-xs font-bold text-emerald-900">
                {result?.advisoryNote || 'No close match found in the loaded sources'}
              </p>
              <p className="text-[10px] text-emerald-700">
                This question does not closely match any archived past paper or loaded bank item.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
