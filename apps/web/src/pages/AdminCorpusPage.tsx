import React, { useState, useEffect } from 'react';
import { apiRequest } from '../lib/api-client';
import { formatDate } from '../lib/utils';
import { ModalPortal } from '../components/ModalPortal';
import { LoadingState } from '../components/LoadingState';
import {
  UploadCloud,
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  ShieldAlert,
  X,
} from '../lib/icons';

interface CorpusItem {
  id: string;
  name: string;
  licenceNote?: string;
  sourceLabel: string;
  version: number;
  status: 'ACTIVE' | 'DISABLED';
  indexStatus: 'PENDING' | 'INDEXING' | 'READY' | 'FAILED';
  indexProgress: number;
  indexError?: string;
  questionCount: number;
  yearMin?: number;
  yearMax?: number;
  languages?: Record<string, number>;
  importedAt: string;
  importedBy?: { id: string; name: string };
  disabledBy?: { id: string; name: string };
  disableReason?: string;
}

interface ValidationReport {
  valid: boolean;
  totalRows: number;
  validRows: number;
  errorCount: number;
  errors: { row: number; field: string; message: string }[];
  withinFileDupeCount: number;
  crossCorpusDupeCount: number;
  withinFileDupes: { row: number; key: string }[];
  crossCorpusDupes: { row: number; existingCorpusId: string; key: string }[];
  preview: any[];
  errorReportCsv?: string | null;
  detectedFormat?: string;
}

export const AdminCorpusPage: React.FC = () => {
  const [corpora, setCorpora] = useState<CorpusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Upload & Validation State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [corpusName, setCorpusName] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [licenceNote, setLicenceNote] = useState('');
  const [allowUnknownColumns, setAllowUnknownColumns] = useState(false);
  const [withinFileStrategy, setWithinFileStrategy] = useState<'SKIP' | 'KEEP'>('SKIP');
  const [crossCorpusStrategy, setCrossCorpusStrategy] = useState<'SKIP' | 'KEEP'>('SKIP');

  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationReport | null>(null);
  const [committing, setCommitting] = useState(false);

  // View Corpus Questions Modal
  const [viewingCorpus, setViewingCorpus] = useState<CorpusItem | null>(null);
  const [corpusQuestions, setCorpusQuestions] = useState<any[]>([]);
  const [corpusTotalQ, setCorpusTotalQ] = useState(0);
  const [corpusPage, setCorpusPage] = useState(1);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  // Disable Corpus Modal
  const [disablingCorpus, setDisablingCorpus] = useState<CorpusItem | null>(null);
  const [disableReason, setDisableReason] = useState('');
  const [disableTotp, setDisableTotp] = useState('');
  const [disablingLoading, setDisablingLoading] = useState(false);

  const fetchCorpora = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<{ success: boolean; data: CorpusItem[] }>('/corpus/paper-corpora');
      setCorpora(res.data || []);
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Failed to load paper corpora.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCorpora();
  }, []);

  // Handle file select
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setValidationResult(null);
      setMsg(null);
      // Auto-populate name if empty
      if (!corpusName) {
        const base = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setCorpusName(base);
      }
      if (!sourceLabel) {
        setSourceLabel('NTA Archive');
      }
    }
  };

  // Validate Upload
  const handleValidate = async () => {
    if (!selectedFile) return;
    setValidating(true);
    setMsg(null);
    setValidationResult(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('allowUnknownColumns', String(allowUnknownColumns));
    if (sourceLabel) formData.append('sourceLabel', sourceLabel);
    if (corpusName) formData.append('name', corpusName);

    try {
      const res = await apiRequest<{ success: boolean; data: ValidationReport }>(
        '/corpus/paper-corpora/validate',
        {
          method: 'POST',
          body: formData,
        },
      );
      setValidationResult(res.data);
      if (res.data.valid) {
        setMsg({
          type: 'success',
          text: `Validation successful! ${res.data.validRows} rows are valid. You can now commit the corpus.`,
        });
      } else {
        setMsg({
          type: 'error',
          text: `Validation detected ${res.data.errorCount} error(s). Please download the error report and correct the file.`,
        });
      }
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Validation request failed.' });
    } finally {
      setValidating(false);
    }
  };

  // Commit Upload
  const handleCommit = async () => {
    if (!selectedFile || !validationResult || !validationResult.valid) return;
    if (!corpusName.trim() || !sourceLabel.trim()) {
      alert('Please fill in Corpus Name and Source Label.');
      return;
    }

    setCommitting(true);
    setMsg(null);

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('name', corpusName.trim());
    formData.append('licenceNote', licenceNote.trim());
    formData.append('sourceLabel', sourceLabel.trim());
    formData.append('withinFileStrategy', withinFileStrategy);
    formData.append('crossCorpusStrategy', crossCorpusStrategy);
    formData.append('allowUnknownColumns', String(allowUnknownColumns));

    try {
      const res = await apiRequest<{ success: boolean; data: any }>('/corpus/paper-corpora/commit', {
        method: 'POST',
        body: formData,
      });

      setMsg({
        type: 'success',
        text: `Corpus "${corpusName}" successfully imported (${res.data.importedCount} questions). Indexing job queued!`,
      });

      // Reset form
      setSelectedFile(null);
      setValidationResult(null);
      setCorpusName('');
      setLicenceNote('');
      setSourceLabel('');

      // Refresh list
      fetchCorpora();
    } catch (err: any) {
      setMsg({ type: 'error', text: err.message || 'Commit failed.' });
    } finally {
      setCommitting(false);
    }
  };

  // Disable Corpus
  const handleDisableConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablingCorpus) return;
    if (disableReason.trim().length < 10) {
      alert('Written reason must be at least 10 characters.');
      return;
    }
    if (!/^\d{6}$/.test(disableTotp.trim())) {
      alert('Valid 6-digit TOTP token required.');
      return;
    }

    setDisablingLoading(true);
    try {
      await apiRequest(`/corpus/paper-corpora/${disablingCorpus.id}/disable`, {
        method: 'PATCH',
        body: JSON.stringify({
          reason: disableReason.trim(),
          totpToken: disableTotp.trim(),
        }),
      });

      setMsg({
        type: 'success',
        text: `Corpus "${disablingCorpus.name}" has been disabled and removed from the active originality index.`,
      });
      setDisablingCorpus(null);
      setDisableReason('');
      setDisableTotp('');
      fetchCorpora();
    } catch (err: any) {
      alert(err.message || 'Failed to disable corpus.');
    } finally {
      setDisablingLoading(false);
    }
  };

  // Load questions for viewing
  const handleOpenQuestions = async (c: CorpusItem, page = 1) => {
    setViewingCorpus(c);
    setCorpusPage(page);
    setLoadingQuestions(true);
    try {
      const res = await apiRequest<{ success: boolean; data: { questions: any[]; total: number } }>(
        `/corpus/paper-corpora/${c.id}?page=${page}&limit=20`,
      );
      setCorpusQuestions(res.data.questions || []);
      setCorpusTotalQ(res.data.total || 0);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoadingQuestions(false);
    }
  };

  // Download error report CSV
  const downloadErrorReport = () => {
    if (!validationResult?.errorReportCsv) return;
    const blob = new Blob([validationResult.errorReportCsv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `validation_errors_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Previous-Year Question Papers
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200 font-semibold">
              Admin Access Only
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Upload and manage the reference corpus of previous-year papers used for live duplicate detection.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <a
            href="/api/corpus/paper-corpora/templates/csv"
            download="corpus_template.csv"
            className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>CSV Template</span>
          </a>
          <a
            href="/api/corpus/paper-corpora/templates/json"
            download="corpus_example.json"
            className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 shadow-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>JSON Example</span>
          </a>
        </div>
      </div>

      {/* Notifications */}
      {msg && (
        <div
          className={`p-4 rounded-xl border flex items-center space-x-3 text-sm ${
            msg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          {msg.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600" />
          )}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Upload & Validation Section */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
        <h2 className="text-base font-bold text-slate-900 flex items-center space-x-2">
          <UploadCloud className="w-5 h-5 text-red-600" />
          <span>Upload & Validate Past Papers File</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Corpus Name *</label>
            <input
              type="text"
              required
              value={corpusName}
              onChange={(e) => setCorpusName(e.target.value)}
              placeholder="e.g., JEE Advanced 2023 All Shifts"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Source Label *</label>
            <input
              type="text"
              required
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
              placeholder="e.g., NTA Official Release"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Licence Note (Optional)</label>
            <input
              type="text"
              value={licenceNote}
              onChange={(e) => setLicenceNote(e.target.value)}
              placeholder="e.g., Public domain exam release / QA use"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-600"
            />
          </div>
        </div>

        {/* File Dropzone */}
        <div className="border-2 border-dashed border-slate-300 rounded-2xl p-6 text-center hover:border-red-500 transition-colors bg-slate-50/50">
          <input
            type="file"
            id="corpus-file"
            accept=".csv,.json"
            onChange={handleFileChange}
            className="hidden"
          />
          <label htmlFor="corpus-file" className="cursor-pointer space-y-2 block">
            <UploadCloud className="w-10 h-10 mx-auto text-red-500" />
            <div className="text-sm font-semibold text-slate-900">
              {selectedFile ? selectedFile.name : 'Click to select structured CSV or JSON file'}
            </div>
            <p className="text-xs text-slate-500">
              Maximum file size: 25 MB (up to 200,000 questions per file).
            </p>
          </label>
        </div>

        {/* Options & Action Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-100">
          <label className="flex items-center space-x-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={allowUnknownColumns}
              onChange={(e) => setAllowUnknownColumns(e.target.checked)}
              className="rounded text-red-600 focus:ring-red-500"
            />
            <span>Allow unknown/extra columns (ignore extra metadata)</span>
          </label>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={!selectedFile || validating}
              onClick={handleValidate}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white shadow-xs disabled:opacity-50 flex items-center space-x-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${validating ? 'animate-spin' : ''}`} />
              <span>{validating ? 'Validating...' : 'Validate File'}</span>
            </button>

            <button
              type="button"
              disabled={!validationResult || !validationResult.valid || committing}
              onClick={handleCommit}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs disabled:opacity-40 flex items-center space-x-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{committing ? 'Importing...' : 'Commit to Corpus'}</span>
            </button>
          </div>
        </div>

        {/* Validation Results & Duplicates Review */}
        {validationResult && (
          <div className="p-4 rounded-xl border space-y-4 bg-slate-50/80 border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div className="flex items-center space-x-3 text-xs">
                <span className="font-bold text-slate-900">Validation Status:</span>
                {validationResult.valid ? (
                  <span className="px-2.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                    PASSED (Zero Errors)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full font-bold bg-red-100 text-red-800">
                    FAILED ({validationResult.errorCount} Errors)
                  </span>
                )}
                <span className="text-slate-500 font-mono">
                  Total: {validationResult.totalRows} | Valid: {validationResult.validRows}
                </span>
              </div>

              {validationResult.errors.length > 0 && (
                <button
                  type="button"
                  onClick={downloadErrorReport}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 flex items-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Error Report (CSV)</span>
                </button>
              )}
            </div>

            {/* Duplicate Handling Selector */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 bg-white rounded-xl border border-slate-200 text-xs">
              <div>
                <label className="block font-bold text-slate-900 mb-1">
                  Duplicates within this file ({validationResult.withinFileDupeCount} detected):
                </label>
                <div className="flex items-center space-x-3">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="within"
                      value="SKIP"
                      checked={withinFileStrategy === 'SKIP'}
                      onChange={() => setWithinFileStrategy('SKIP')}
                      className="text-red-600 focus:ring-red-500"
                    />
                    <span>SKIP duplicate rows (keep first occurrence)</span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="within"
                      value="KEEP"
                      checked={withinFileStrategy === 'KEEP'}
                      onChange={() => setWithinFileStrategy('KEEP')}
                      className="text-red-600 focus:ring-red-500"
                    />
                    <span>KEEP all rows</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-900 mb-1">
                  Duplicates against existing corpora ({validationResult.crossCorpusDupeCount} detected):
                </label>
                <div className="flex items-center space-x-3">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="cross"
                      value="SKIP"
                      checked={crossCorpusStrategy === 'SKIP'}
                      onChange={() => setCrossCorpusStrategy('SKIP')}
                      className="text-red-600 focus:ring-red-500"
                    />
                    <span>SKIP already-imported questions</span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="cross"
                      value="KEEP"
                      checked={crossCorpusStrategy === 'KEEP'}
                      onChange={() => setCrossCorpusStrategy('KEEP')}
                      className="text-red-600 focus:ring-red-500"
                    />
                    <span>KEEP duplicates</span>
                  </label>
                </div>
              </div>
            </div>

            {/* First 20 Rows Preview */}
            {validationResult.preview.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Validation Preview (First {validationResult.preview.length} Rows):
                </h4>
                <div className="overflow-x-auto bg-white rounded-xl border border-slate-200 shadow-xs max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold sticky top-0">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Exam</th>
                        <th className="px-3 py-2">Year</th>
                        <th className="px-3 py-2">Q No</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Stem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {validationResult.preview.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2 font-semibold text-slate-800">{row.source_exam}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{row.year}</td>
                          <td className="px-3 py-2 font-mono text-slate-600">{row.question_no}</td>
                          <td className="px-3 py-2">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px]">
                              {row.question_type}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-700 truncate max-w-xs">{row.stem}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Corpus List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Archived Question Corpora</h2>
          <button
            onClick={fetchCorpora}
            disabled={loading}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-red-600' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <LoadingState title="Loading Reference Corpora..." description="Fetching past-paper indexes and status" />
        ) : corpora.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
            No previous-year question corpora uploaded yet. Upload a CSV or JSON file above to populate the reference database.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase font-semibold">
                <tr>
                  <th className="px-4 py-3">Corpus Name</th>
                  <th className="px-4 py-3">Questions</th>
                  <th className="px-4 py-3">Years</th>
                  <th className="px-4 py-3">Languages</th>
                  <th className="px-4 py-3">Import Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Index Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {corpora.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{c.name}</div>
                      <div className="text-[11px] text-slate-500">{c.sourceLabel}</div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-800">
                      {c.questionCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      {c.yearMin && c.yearMax ? `${c.yearMin} – ${c.yearMax}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.languages &&
                          Object.entries(c.languages).map(([lang, count]) => (
                            <span
                              key={lang}
                              className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[10px] text-slate-700"
                            >
                              {lang.toUpperCase()}: {count}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.importedAt)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          c.status === 'ACTIVE'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          c.indexStatus === 'READY'
                            ? 'bg-blue-50 text-blue-800 border border-blue-200'
                            : c.indexStatus === 'INDEXING'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : c.indexStatus === 'FAILED'
                            ? 'bg-red-50 text-red-800 border border-red-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {c.indexStatus} {c.indexStatus === 'INDEXING' && `(${c.indexProgress}%)`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        type="button"
                        onClick={() => handleOpenQuestions(c)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 shadow-xs"
                      >
                        View
                      </button>
                      {c.status === 'ACTIVE' && (
                        <button
                          type="button"
                          onClick={() => setDisablingCorpus(c)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 shadow-xs"
                        >
                          Disable
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Disable Corpus Modal (Requires written reason + Step-up MFA) */}
      {disablingCorpus && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-md p-6 border border-slate-200 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center space-x-2 text-red-600">
                  <ShieldAlert className="w-5 h-5" />
                  <h3 className="text-base font-bold text-slate-900">Disable Reference Corpus</h3>
                </div>
                <button
                  onClick={() => setDisablingCorpus(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed">
                Disabling <strong>{disablingCorpus.name}</strong> will remove all {disablingCorpus.questionCount} questions
                from the live copy checker index. This action is auditable and requires administrative step-up MFA.
              </p>

              <form onSubmit={handleDisableConfirm} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Written Justification (Minimum 10 characters) *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={disableReason}
                    onChange={(e) => setDisableReason(e.target.value)}
                    placeholder="e.g., Replacement corpus v2 uploaded; paper retracted due to syllabus change"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Step-Up MFA TOTP Token (6 digits) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={disableTotp}
                    onChange={(e) => setDisableTotp(e.target.value)}
                    placeholder="123456"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono tracking-widest text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-600"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setDisablingCorpus(null)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={disablingLoading || disableReason.trim().length < 10 || disableTotp.length !== 6}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-xs disabled:opacity-50"
                  >
                    {disablingLoading ? 'Disabling...' : 'Confirm Disable & Unindex'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* View Corpus Questions Modal */}
      {viewingCorpus && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
            <div className="bg-white rounded-2xl w-full max-w-4xl p-6 border border-slate-200 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-shrink-0">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{viewingCorpus.name}</h3>
                  <p className="text-xs text-slate-500 font-mono">
                    Public past-paper material • {corpusTotalQ} questions • Source: {viewingCorpus.sourceLabel}
                  </p>
                </div>
                <button
                  onClick={() => setViewingCorpus(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {loadingQuestions ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <RefreshCw className="w-5 h-5 mx-auto animate-spin text-red-600 mb-2" />
                  <span>Loading questions...</span>
                </div>
              ) : (
                <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                  {corpusQuestions.map((q) => (
                    <div key={q.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {q.sourceExam} ({q.year}) — Q#{q.questionNo}
                          {q.shift && ` [${q.shift}]`}
                          {q.paperCode && ` (${q.paperCode})`}
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-200 font-mono text-[10px]">
                            {q.questionType}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[10px]">
                            {q.language.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <p className="text-slate-800 font-medium">{q.stem}</p>
                      {q.options && q.options.length > 0 && (
                        <div className="grid grid-cols-2 gap-1.5 pt-1">
                          {q.options.map((opt: string, oIdx: number) => (
                            <div key={oIdx} className="p-1.5 rounded bg-white border border-slate-200 text-[11px] text-slate-700">
                              <span className="font-bold text-slate-500 mr-1.5">
                                {String.fromCharCode(65 + oIdx)}.
                              </span>
                              {opt}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 flex-shrink-0 text-xs text-slate-600">
                <span>
                  Showing {corpusQuestions.length} of {corpusTotalQ} questions
                </span>
                <div className="space-x-2">
                  <button
                    disabled={corpusPage <= 1 || loadingQuestions}
                    onClick={() => handleOpenQuestions(viewingCorpus, corpusPage - 1)}
                    className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="font-mono">{corpusPage}</span>
                  <button
                    disabled={corpusQuestions.length < 20 || loadingQuestions}
                    onClick={() => handleOpenQuestions(viewingCorpus, corpusPage + 1)}
                    className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};
