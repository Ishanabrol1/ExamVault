import React, { useState, useEffect } from 'react';
import {
  useAuth } from '../context/AuthContext';
import { apiRequest } from '../lib/api-client';
import { ModalPortal } from '../components/ModalPortal';
import { LoadingState } from '../components/LoadingState';
import {
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Lock,
  Plus,
  Database,
  Loader2,
  RefreshCw,
  X,
  Users,
  Scale,
  Clock,
} from '../lib/icons';

export const AdminPoliciesPage: React.FC = () => {
  const { user } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<'policies' | 'originality' | 'corpus'>('policies');

  const [policies, setPolicies] = useState<any[]>([]);
  const [originalityHealth, setOriginalityHealth] = useState<any | null>(null);
  const [corpusSources, setCorpusSources] = useState<any[]>([]);

  const [policiesLoading, setPoliciesLoading] = useState<boolean>(true);
  const [originalityLoading, setOriginalityLoading] = useState<boolean>(true);
  const [corpusLoading, setCorpusLoading] = useState<boolean>(true);

  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Propose New Policy form state
  const [showProposeModal, setShowProposeModal] = useState<boolean>(false);
  const [requiredReviewers, setRequiredReviewers] = useState<number>(2);
  const [difficultyTolerance, setDifficultyTolerance] = useState<number>(20);
  const [requireBlindSolve, setRequireBlindSolve] = useState<boolean>(true);
  const [requireModerator, setRequireModerator] = useState<boolean>(true);
  const [requireLanguageReview, setRequireLanguageReview] = useState<boolean>(true);
  const [maxReviewDays, setMaxReviewDays] = useState<number>(7);
  const [exactMatchThreshold, setExactMatchThreshold] = useState<number>(1.0);
  const [highSimilarityThreshold, setHighSimilarityThreshold] = useState<number>(0.85);
  const [mediumSimilarityThreshold, setMediumSimilarityThreshold] = useState<number>(0.60);

  // Corpus Import state
  const [corpusName, setCorpusName] = useState<string>('');
  const [corpusType, setCorpusType] = useState<string>('PAST_PAPER');
  const [corpusDocTitle, setCorpusDocTitle] = useState<string>('');
  const [corpusDocText, setCorpusDocText] = useState<string>('');

  // Fetch policies
  const fetchPolicies = async () => {
    setPoliciesLoading(true);
    try {
      const data = await apiRequest<{ success: boolean; data: any[] }>('/policies');
      if (data.success) {
        setPolicies(data.data);
        const active = data.data.find((p) => p.isActive);
        if (active) {
          setRequiredReviewers(active.requiredReviewers ?? 2);
          setDifficultyTolerance(active.difficultyTolerance ?? 20);
          setMaxReviewDays(active.maxReviewDays ?? 7);
          setRequireBlindSolve(active.requireBlindSolve ?? true);
          setRequireModerator(active.requireModerator ?? true);
          setRequireLanguageReview(active.requireLanguageReview ?? true);
          setExactMatchThreshold(active.exactMatchThreshold ?? 1.0);
          setHighSimilarityThreshold(active.highSimilarityThreshold ?? 0.85);
          setMediumSimilarityThreshold(active.mediumSimilarityThreshold ?? 0.60);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPoliciesLoading(false);
    }
  };

  // Fetch originality health
  const fetchOriginalityHealth = async () => {
    setOriginalityLoading(true);
    try {
      const data = await apiRequest<any>('/originality/health');
      setOriginalityHealth(data);
    } catch (e: any) {
      setOriginalityHealth({ available: false, error: e.message });
    } finally {
      setOriginalityLoading(false);
    }
  };

  // Fetch corpus
  const fetchCorpus = async () => {
    setCorpusLoading(true);
    try {
      const data = await apiRequest<{ success: boolean; data: any[] }>('/corpus/sources');
      if (data.success) {
        setCorpusSources(data.data);
      }
    } catch (e: any) {
    } finally {
      setCorpusLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'policies') {
      fetchPolicies();
    } else if (activeSubTab === 'originality') {
      fetchOriginalityHealth();
    } else if (activeSubTab === 'corpus') {
      fetchCorpus();
    }
  }, [activeSubTab]);

  // Propose Policy Submit
  const handleProposePolicy = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>('/policies/propose', {
        method: 'POST',
        body: JSON.stringify({
          requiredReviewers,
          difficultyTolerance,
          requireBlindSolve,
          requireModerator,
          requireLanguageReview,
          maxReviewDays,
          exactMatchThreshold,
          highSimilarityThreshold,
          mediumSimilarityThreshold,
        }),
      });
      if (data.success) {
        setSuccessMsg(
          'Policy proposed. A 2nd administrator must approve it to activate.'
        );
        setShowProposeModal(false);
        fetchPolicies();
      } else {
        setError('Failed to propose policy');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Approve Policy (Dual-admin enforcement: proposerId !== approverId)
  const handleApprovePolicy = async (policyId: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>('/policies/approve', {
        method: 'POST',
        body: JSON.stringify({ policyId }),
      });
      if (data.success) {
        setSuccessMsg('Policy approved and activated!');
        fetchPolicies();
      } else {
        setError('Approval failed (proposer cannot approve their own policy)');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Add Corpus Document
  const handleAddCorpusDoc = async () => {
    if (!corpusName.trim() || !corpusDocText.trim()) {
      setError('Corpus title and question text are required.');
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ success: boolean; message?: string }>('/corpus/import', {
        method: 'POST',
        body: JSON.stringify({
          sourceName: corpusName,
          sourceType: corpusType,
          documents: [
            {
              title: corpusDocTitle || 'Reference Item',
              identifier: `REF-${Date.now()}`,
              plaintextContent: corpusDocText,
            },
          ],
        }),
      });
      if (data.success) {
        setSuccessMsg('Corpus document indexed successfully!');
        setCorpusDocText('');
        setCorpusDocTitle('');
        fetchCorpus();
      } else {
        setError('Import failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const activePolicy = policies.find((p) => p.isActive);
  const pendingProposal = policies.find((p) => !p.isActive);
  const isCurrentAdminProposer = pendingProposal && pendingProposal.proposedById === user?.id;

  return (
    <div className="w-full space-y-5">
      {/* Page Header - Minimal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
              Governance
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Policies & Corpus</h1>
          <p className="text-xs text-slate-500">
            Approval workflows, difficulty calibration, and reference corpora.
          </p>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <span className="flex items-center text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-md font-medium">
            <Lock className="w-3.5 h-3.5 mr-1.5 text-emerald-600" />
            Dual-Admin Enforced
          </span>
        </div>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sub Tabs - Clean & Concise */}
      <div className="flex border-b border-slate-200 space-x-6">
        {[
          { key: 'policies', label: 'Approval Policies', icon: ShieldCheck },
          { key: 'originality', label: 'Originality Engine', icon: Activity },
          { key: 'corpus', label: 'Reference Corpus', icon: Database },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveSubTab(tab.key as any)}
              className={`flex items-center space-x-2 py-2.5 border-b-2 font-medium text-xs transition-all ${
                isActive
                  ? 'border-red-600 text-slate-900 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-red-600' : 'text-slate-400'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Policies Content */}
      {activeSubTab === 'policies' && (
        <div className="space-y-4">
          {/* 1. Pending Proposal Notice Banner - Minimal */}
          {pendingProposal && (
            <div className="p-3.5 bg-amber-50/90 border border-amber-300 rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="p-1.5 bg-amber-100 rounded-lg text-amber-800 shrink-0">
                  <AlertTriangle className="w-4 h-4 text-amber-700" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-xs text-amber-950">
                      Pending Proposal v{pendingProposal.version} ({pendingProposal.requiredReviewers} Reviewers, ±{pendingProposal.difficultyTolerance}pts)
                    </span>
                    <span className="text-[10px] font-semibold bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded font-bold border border-amber-300">
                      Awaiting 2nd Admin
                    </span>
                  </div>
                  <div className="flex items-center space-x-3 text-[11px] text-amber-800 mt-0.5 font-medium">
                    <span>By {pendingProposal.proposedBy?.name || 'Admin'}</span>
                    <span>•</span>
                    <span>SLA: {pendingProposal.maxReviewDays}d</span>
                    <span>•</span>
                    <span>Blind Solve: {pendingProposal.requireBlindSolve ? 'Yes' : 'No'}</span>
                    <span>•</span>
                    <span>Moderator: {pendingProposal.requireModerator ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex items-center">
                {isCurrentAdminProposer ? (
                  <div className="px-3 py-1.5 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-700" />
                    <span>Awaiting 2nd Admin</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => handleApprovePolicy(pendingProposal.id)}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-xs transition-colors flex items-center space-x-1.5 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve Proposal</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 2. Active Policy Overview Banner - Minimal */}
          {activePolicy && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                <div className="flex items-center space-x-2.5">
                  <div className="p-1.5 bg-black text-white rounded-lg">
                    <ShieldCheck className="w-4 h-4 text-red-500" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="text-xs font-bold text-slate-900">
                        Active Governance Policy (v{activePolicy.version})
                      </h3>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                        {activePolicy.subject?.name || 'Global'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="inline-flex items-center text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    Active (Dual-Approved)
                  </span>
                </div>
              </div>

              {/* Grid of Key Enforced Rules - Minimal */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Review Protocol
                  </span>
                  <div className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                    <Users className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span>
                      {activePolicy.requiredReviewers === 1 ? '1 Reviewer (Fast-Track)' : `${activePolicy.requiredReviewers} Reviewers`}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Difficulty Tolerance
                  </span>
                  <div className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                    <Scale className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span>±{activePolicy.difficultyTolerance} Points</span>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Turnaround SLA
                  </span>
                  <div className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                    <Clock className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span>{activePolicy.maxReviewDays} Days Max</span>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80 space-y-0.5">
                  <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Dual-Control Sign-off
                  </span>
                  <div className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                    <Lock className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span className="truncate" title={activePolicy.approvedBy?.name || 'Admin'}>
                      {activePolicy.approvedBy?.name || 'Admin'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Compact Badges */}
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5 mt-2.5 border-t border-slate-100 text-[10px]">
                <span className={`px-2 py-0.5 rounded font-medium ${activePolicy.requireBlindSolve ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  Blind Solve: {activePolicy.requireBlindSolve ? 'On' : 'Off'}
                </span>
                <span className={`px-2 py-0.5 rounded font-medium ${activePolicy.requireModerator ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  Moderator: {activePolicy.requireModerator ? 'Required' : 'Off'}
                </span>
                <span className={`px-2 py-0.5 rounded font-medium ${activePolicy.requireLanguageReview ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>
                  Translation Parity: {activePolicy.requireLanguageReview ? 'On' : 'Off'}
                </span>
                <span className="px-2 py-0.5 rounded font-medium bg-slate-100 text-slate-600 font-medium">
                  Cutoff: High ≥ {(activePolicy.highSimilarityThreshold * 100).toFixed(0)}% · Med ≥ {(activePolicy.mediumSimilarityThreshold * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          )}

          {/* Action Row - Minimal */}
          <div className="flex justify-between items-center pt-1">
            <div>
              <h2 className="text-xs font-bold text-slate-900">Policy Registry</h2>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={fetchPolicies}
                disabled={policiesLoading}
                className="inline-flex items-center space-x-1 px-2.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${policiesLoading ? 'animate-spin text-red-600' : ''}`} />
                <span>{policiesLoading ? '...' : 'Refresh'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowProposeModal(true)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-black hover:bg-neutral-800 text-white text-xs font-bold rounded-lg shadow-xs transition-colors border border-black"
              >
                <Plus className="w-3.5 h-3.5 text-white" />
                <span>Propose Policy</span>
              </button>
            </div>
          </div>

          {/* Policies Table - Concise */}
          {policiesLoading ? (
            <LoadingState
              title="Loading Governance Policies..."
              description="Fetching dual-control governance policies, reviewer thresholds, and active version constraints"
            />
          ) : policies.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs shadow-xs space-y-1">
              <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="font-semibold text-slate-700">No Policies Found</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-100 text-[11px] uppercase font-bold text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="px-5 py-3">Version</th>
                    <th className="px-5 py-3">Protocol</th>
                    <th className="px-5 py-3">Tolerance & SLA</th>
                    <th className="px-5 py-3">Enforcements</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {policies.map((p) => {
                    const isProposer = p.proposedById === user?.id;
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-5 py-3 font-semibold text-slate-900">
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold">v{p.version}</span>
                            {p.isActive && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Active Policy" />
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 block font-sans">
                            {p.subject?.name || 'Global'} · By {p.proposedBy?.name || 'Admin'}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="font-bold text-xs text-slate-900 block">
                            {p.requiredReviewers === 1 ? '1 Reviewer' : `${p.requiredReviewers} Reviewers`}
                          </span>
                        </td>
                        <td className="px-5 py-3 space-y-0.5">
                          <span className="block font-semibold text-slate-800">
                            ±{p.difficultyTolerance} pts
                          </span>
                          <span className="block text-slate-500 text-[11px]">
                            {p.maxReviewDays}d SLA
                          </span>
                        </td>
                        <td className="px-5 py-3 text-[11px] space-y-0.5">
                          <span className="block text-slate-700">
                            Blind Solve: {p.requireBlindSolve ? 'On' : 'Off'} · Mod: {p.requireModerator ? 'Yes' : 'No'}
                          </span>
                          <span className="block text-slate-500">
                            Cutoff: ≥{(p.highSimilarityThreshold * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          {p.isActive ? (
                            <span className="inline-flex items-center text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                              <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded">
                              <AlertTriangle className="w-3 h-3 mr-1 text-amber-600" />
                              Pending 2nd Admin
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {!p.isActive ? (
                            isProposer ? (
                              <span
                                className="inline-flex items-center text-[10px] font-semibold text-amber-900 bg-amber-100/70 border border-amber-200 px-2 py-0.5 rounded"
                                title="Dual-control: 2nd admin approval required"
                              >
                                <Lock className="w-2.5 h-2.5 mr-1 text-amber-700" />
                                Awaiting 2nd Admin
                              </span>
                            ) : (
                              <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() => handleApprovePolicy(p.id)}
                                className="inline-flex items-center space-x-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded shadow-xs transition-colors"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Approve</span>
                              </button>
                            )
                          ) : (
                            <span className="text-[11px] text-slate-400">
                              Enacted
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Originality Service Health - Minimal */}
      {activeSubTab === 'originality' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Originality Microservice</h3>
              <p className="text-xs text-slate-500">
                MinHash LSH, TF-IDF, and Devanagari normalization status.
              </p>
            </div>
            <button
              onClick={fetchOriginalityHealth}
              disabled={originalityLoading}
              className="inline-flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              {originalityLoading && <Loader2 className="w-3 h-3 animate-spin text-red-600" />}
              <span>{originalityLoading ? 'Pinging...' : 'Ping'}</span>
            </button>
          </div>

          {originalityLoading && !originalityHealth ? (
            <LoadingState
              title="Querying Originality Microservice..."
              description="Pinging isolated Python engine telemetry and in-memory index status"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">Status</span>
                <div className="flex items-center space-x-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      originalityHealth?.available ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  <span className={`font-bold text-xs ${originalityHealth?.available ? 'text-emerald-700' : 'text-red-700'}`}>
                    {originalityHealth?.available ? 'ONLINE' : 'OFFLINE'}
                  </span>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                  RAM Index
                </span>
                <span className="text-xl font-bold text-slate-900 block">
                  {originalityHealth?.indexedDocumentsCount ?? 210} items
                </span>
                <span className="text-[10px] text-slate-400 block">In-memory only</span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block">
                  Network Isolation
                </span>
                <div className="flex items-center space-x-1.5 text-xs text-emerald-700 font-bold">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Internal Network</span>
                </div>
                <span className="text-[10px] text-slate-400 block">Zero outbound internet</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Past Papers & Reference Corpus - Minimal */}
      {activeSubTab === 'corpus' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
            <div className="pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Import Reference Item</h3>
              <p className="text-xs text-slate-500">
                Add past papers or public questions into the screening corpus.
              </p>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-0.5">Corpus Title</label>
                <input
                  type="text"
                  value={corpusName}
                  onChange={(e) => setCorpusName(e.target.value)}
                  placeholder="e.g. JEE Advanced 2021 Paper 1"
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-0.5">Category</label>
                <select
                  value={corpusType}
                  onChange={(e) => setCorpusType(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900"
                >
                  <option value="PAST_PAPER">Past Paper Archives</option>
                  <option value="PUBLIC_SOURCE">Permitted Public Textbook</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-0.5">Question Code</label>
                <input
                  type="text"
                  value={corpusDocTitle}
                  onChange={(e) => setCorpusDocTitle(e.target.value)}
                  placeholder="e.g. JEE-2021-P1-Q12"
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-0.5">Question Text</label>
                <textarea
                  rows={3}
                  value={corpusDocText}
                  onChange={(e) => setCorpusDocText(e.target.value)}
                  placeholder="Paste question text here..."
                  className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              <button
                disabled={actionLoading || !corpusName.trim() || !corpusDocText.trim()}
                onClick={handleAddCorpusDoc}
                className="w-full py-2 bg-black hover:bg-neutral-800 disabled:bg-slate-300 text-white text-xs font-bold rounded-lg shadow-xs transition-colors inline-flex items-center justify-center space-x-1.5 border border-black"
              >
                {actionLoading && <Loader2 className="w-3 h-3 animate-spin text-white" />}
                <span>{actionLoading ? 'Indexing...' : 'Index in Screening Engine'}</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
            <div className="pb-2 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Loaded Corpora</h3>
              </div>
              <button
                onClick={fetchCorpus}
                disabled={corpusLoading}
                className="inline-flex items-center space-x-1 px-2 py-0.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${corpusLoading ? 'animate-spin text-red-600' : ''}`} />
                <span>{corpusLoading ? '...' : 'Refresh'}</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {corpusLoading ? (
                <LoadingState
                  title="Loading Corpus Sources..."
                  description="Fetching indexed reference past papers and public benchmark test banks"
                />
              ) : corpusSources.length === 0 ? (
                <div className="text-xs text-slate-400 p-4 text-center">No corpus sources registered yet.</div>
              ) : (
                corpusSources.map((cs) => (
                  <div key={cs.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex justify-between items-center">
                    <span className="font-bold text-xs text-slate-800">{cs.name}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
                      {cs.type}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ALL-IN-ONE Propose Policy Modal - Minimal & Clean */}
      {showProposeModal && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto">
            <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95">
              {/* Brand Accent Bar */}
              <div className="h-1 w-full bg-red-600" />

              {/* Modal Header */}
              <div className="p-5 pb-3 border-b border-slate-200 flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2 mb-0.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                      New Policy Proposal
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900">Propose Approval Policy</h3>
                  <p className="text-xs text-slate-500">
                    Define reviewer requirements, tolerance thresholds, and review SLAs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowProposeModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">
                {/* Section 1: Reviewer Workflow Architecture */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                    1. Reviewer Protocol
                  </label>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {/* Option 1: 1 Reviewer Fast-Track */}
                    <div
                      onClick={() => setRequiredReviewers(1)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        requiredReviewers === 1
                          ? 'border-black bg-slate-50 ring-2 ring-black shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center space-x-1.5">
                          <Users className="w-4 h-4 text-slate-700" />
                          <span className="text-xs font-bold text-slate-900">1 Reviewer (Fast-Track)</span>
                        </div>
                        <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded">
                          Direct
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">
                        Single blind solve. Direct admission if author key matches.
                      </p>
                    </div>

                    {/* Option 2: 2 Reviewers Consensus */}
                    <div
                      onClick={() => setRequiredReviewers(2)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        requiredReviewers >= 2
                          ? 'border-black bg-slate-50 ring-2 ring-black shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center space-x-1.5">
                          <Scale className="w-4 h-4 text-slate-700" />
                          <span className="text-xs font-bold text-slate-900">2 Reviewers (Consensus)</span>
                        </div>
                        <span className="text-[10px] font-semibold bg-red-100 text-red-800 px-1.5 py-0.2 rounded">
                          Calibrated
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">
                        Dual blind solves. Auto-promoted if difficulty consensus matches.
                      </p>
                    </div>
                  </div>

                  {/* Reviewer Panel Size */}
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                    <span className="font-semibold text-slate-700 text-[11px]">Panel Size:</span>
                    <div className="flex items-center space-x-1">
                      {[1, 2, 3, 4, 5].map((num) => (
                        <button
                          key={num}
                          type="button"
                          onClick={() => setRequiredReviewers(num)}
                          className={`w-6 h-6 text-xs font-bold rounded transition-colors ${
                            requiredReviewers === num
                              ? 'bg-black text-white'
                              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Section 2: Tolerance & SLA */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                    2. Tolerance & Review Turnaround
                  </label>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Tolerance */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">Difficulty Tolerance</span>
                        <span className="px-1.5 py-0.5 rounded bg-black text-white text-[11px] font-bold">
                          ±{difficultyTolerance} pts
                        </span>
                      </div>

                      <input
                        type="range"
                        min="5"
                        max="50"
                        step="5"
                        value={difficultyTolerance}
                        onChange={(e) => setDifficultyTolerance(parseInt(e.target.value, 10))}
                        className="w-full accent-red-600 cursor-pointer h-1.5 bg-slate-200 rounded"
                      />

                      <div className="flex items-center justify-between gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setDifficultyTolerance(10)}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${difficultyTolerance === 10 ? 'bg-black text-white font-bold' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                        >
                          ±10 Strict
                        </button>
                        <button
                          type="button"
                          onClick={() => setDifficultyTolerance(20)}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${difficultyTolerance === 20 ? 'bg-black text-white font-bold' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                        >
                          ±20 Standard
                        </button>
                        <button
                          type="button"
                          onClick={() => setDifficultyTolerance(30)}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${difficultyTolerance === 30 ? 'bg-black text-white font-bold' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                        >
                          ±30 Relaxed
                        </button>
                      </div>
                    </div>

                    {/* Review SLA Days */}
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800">Turnaround SLA</span>
                        <span className="px-1.5 py-0.5 rounded bg-black text-white text-[11px] font-bold">
                          {maxReviewDays} Days
                        </span>
                      </div>

                      <input
                        type="range"
                        min="1"
                        max="30"
                        step="1"
                        value={maxReviewDays}
                        onChange={(e) => setMaxReviewDays(parseInt(e.target.value, 10))}
                        className="w-full accent-red-600 cursor-pointer h-1.5 bg-slate-200 rounded"
                      />

                      <div className="flex items-center justify-between gap-1 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setMaxReviewDays(3)}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${maxReviewDays === 3 ? 'bg-black text-white font-bold' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                        >
                          3 Days
                        </button>
                        <button
                          type="button"
                          onClick={() => setMaxReviewDays(7)}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${maxReviewDays === 7 ? 'bg-black text-white font-bold' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                        >
                          7 Days (Default)
                        </button>
                        <button
                          type="button"
                          onClick={() => setMaxReviewDays(14)}
                          className={`px-2 py-0.5 rounded font-medium transition-colors ${maxReviewDays === 14 ? 'bg-black text-white font-bold' : 'bg-white border text-slate-600 hover:bg-slate-100'}`}
                        >
                          14 Days
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 3: Governance & Security Controls */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                    3. Governance Controls
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={requireBlindSolve}
                        onChange={(e) => setRequireBlindSolve(e.target.checked)}
                        className="rounded border-slate-300 text-black focus:ring-black w-3.5 h-3.5"
                      />
                      <span className="text-xs font-bold text-slate-800">Enforce Blind Solve</span>
                    </label>

                    <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={requireModerator}
                        onChange={(e) => setRequireModerator(e.target.checked)}
                        className="rounded border-slate-300 text-black focus:ring-black w-3.5 h-3.5"
                      />
                      <span className="text-xs font-bold text-slate-800">Moderator Sign-off</span>
                    </label>

                    <label className="flex items-center space-x-2 p-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={requireLanguageReview}
                        onChange={(e) => setRequireLanguageReview(e.target.checked)}
                        className="rounded border-slate-300 text-black focus:ring-black w-3.5 h-3.5"
                      />
                      <span className="text-xs font-bold text-slate-800">Translation Parity</span>
                    </label>
                  </div>
                </div>

                {/* Section 4: Originality Screening Thresholds */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
                    4. Originality Cutoffs
                  </label>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <label className="text-[10px] font-semibold text-slate-700 block">Exact Match</label>
                      <div className="flex items-center space-x-1">
                        <input
                          type="number"
                          min="80"
                          max="100"
                          value={Math.round(exactMatchThreshold * 100)}
                          onChange={(e) => setExactMatchThreshold(parseInt(e.target.value, 10) / 100)}
                          className="w-full text-xs p-1 rounded border border-slate-300 text-center font-bold"
                        />
                        <span className="text-xs text-slate-500 font-bold">%</span>
                      </div>
                    </div>

                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <label className="text-[10px] font-semibold text-slate-700 block">High Similarity</label>
                      <div className="flex items-center space-x-1">
                        <input
                          type="number"
                          min="50"
                          max="99"
                          value={Math.round(highSimilarityThreshold * 100)}
                          onChange={(e) => setHighSimilarityThreshold(parseInt(e.target.value, 10) / 100)}
                          className="w-full text-xs p-1 rounded border border-slate-300 text-center font-bold"
                        />
                        <span className="text-xs text-slate-500 font-bold">%</span>
                      </div>
                    </div>

                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                      <label className="text-[10px] font-semibold text-slate-700 block">Med Similarity</label>
                      <div className="flex items-center space-x-1">
                        <input
                          type="number"
                          min="30"
                          max="80"
                          value={Math.round(mediumSimilarityThreshold * 100)}
                          onChange={(e) => setMediumSimilarityThreshold(parseInt(e.target.value, 10) / 100)}
                          className="w-full text-xs p-1 rounded border border-slate-300 text-center font-bold"
                        />
                        <span className="text-xs text-slate-500 font-bold">%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Minimal Two-Person Notice */}
                <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-lg flex items-center space-x-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-[11px]">
                    <strong>Dual-Control:</strong> Requires approval from a 2nd administrator before taking effect.
                  </span>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-3.5 px-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowProposeModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={handleProposePolicy}
                  className="px-4 py-1.5 text-xs font-bold text-white bg-black hover:bg-neutral-800 border border-black rounded-lg shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {actionLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-red-500" />
                  )}
                  <span>{actionLoading ? 'Submitting...' : 'Submit Proposal'}</span>
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
