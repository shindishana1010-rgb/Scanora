import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Edit3,
  FileText,
  Share2,
  Trash2,
  X,
  AlertCircle,
} from 'lucide-react';
import { ScannedDocument } from '../types/paperscan';
import {
  downloadPdfBlob,
  generatePdfFromPages,
  shareOrDownloadPdf,
} from '../utils/pdfGenerator';
import { formatBytes, formatScanDateTime } from '../utils/storage';

interface DocumentViewerModalProps {
  document: ScannedDocument | null;
  onClose: () => void;
  onRename: (id: string, newTitle: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export const DocumentViewerModal: React.FC<DocumentViewerModalProps> = ({
  document,
  onClose,
  onRename,
  onDelete,
}) => {
  const [activePageIdx, setActivePageIdx] = useState(0);
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showOcrText, setShowOcrText] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [busyAction, setBusyAction] = useState<'download' | 'share' | 'delete' | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (document) {
      setActivePageIdx(0);
      setIsEditingName(false);
      setDraftTitle(document.title);
      setConfirmDelete(false);
      setShowOcrText(false);
      setCopiedText(false);
      setStatusMessage(null);
    }
  }, [document]);

  if (!document) return null;

  const currentPage = document.pages[activePageIdx] || document.pages[0];
  const hasAnyOcrText = document.pages.some(
    (p) => Boolean(p.ocrText && p.ocrText.trim().length > 0)
  );
  const currentPageText = currentPage?.ocrText?.trim() || '';

  const handleSaveRename = async () => {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(document.title);
      setIsEditingName(false);
      return;
    }
    try {
      await onRename(document.id, trimmed);
      setIsEditingName(false);
      setStatusMessage({ type: 'success', text: 'Document name updated.' });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to rename document.',
      });
    }
  };

  const handleCopyText = async () => {
    const allText = document.pages
      .map((p, idx) =>
        document.pages.length > 1 && p.ocrText
          ? `--- Page ${idx + 1} ---\n${p.ocrText.trim()}`
          : (p.ocrText || '').trim()
      )
      .filter(Boolean)
      .join('\n\n');

    if (!allText) return;
    try {
      await navigator.clipboard.writeText(allText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2200);
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Could not copy text to clipboard in this browser.',
      });
    }
  };

  const handleDownload = async () => {
    if (busyAction) return;
    setBusyAction('download');
    setStatusMessage(null);
    try {
      const pdf = await generatePdfFromPages(
        document.title,
        document.pages,
        document.quality
      );
      downloadPdfBlob(pdf.blob, pdf.filename);
      setStatusMessage({
        type: 'success',
        text: `Downloaded ${pdf.filename} (${formatBytes(pdf.byteSize)}).`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to export PDF.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleShare = async () => {
    if (busyAction) return;
    setBusyAction('share');
    setStatusMessage(null);
    try {
      const pdf = await generatePdfFromPages(
        document.title,
        document.pages,
        document.quality
      );
      const outcome = await shareOrDownloadPdf(
        pdf.blob,
        pdf.filename,
        document.title
      );
      if (outcome === 'shared') {
        setStatusMessage({ type: 'success', text: 'PDF shared.' });
      } else if (outcome === 'downloaded') {
        setStatusMessage({
          type: 'success',
          text: 'Direct sharing unavailable here — downloaded PDF to your device.',
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to share PDF.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (busyAction) return;
    setBusyAction('delete');
    try {
      await onDelete(document.id);
      onClose();
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not delete document.',
      });
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#F7FAFD] text-[#252525]"
      role="dialog"
      aria-modal="true"
      aria-label={document.title}
    >
      {/* Top Header */}
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-white border-b border-[#DCE8F6]">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-2.5 rounded-xl text-[#173B65] hover:bg-[#EAF3FC] transition-colors flex items-center gap-1.5 text-sm font-medium whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="hidden sm:inline">Back</span>
        </button>

        <div className="flex-1 min-w-0 text-center">
          {isEditingName ? (
            <div className="flex items-center justify-center gap-1.5 max-w-md mx-auto">
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') {
                    setDraftTitle(document.title);
                    setIsEditingName(false);
                  }
                }}
                autoFocus
                maxLength={80}
                className="flex-1 min-h-[40px] px-3 py-1 rounded-lg border border-[#173B65] bg-white text-sm font-semibold text-[#252525] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveRename}
                aria-label="Save new name"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#173B65] text-white"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftTitle(document.title);
                  setIsEditingName(false);
                }}
                aria-label="Cancel rename"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-[#EAF3FC] text-[#173B65]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-center gap-1.5">
                <h2 className="font-display text-base sm:text-lg font-bold text-[#173B65] truncate max-w-[200px] sm:max-w-md">
                  {document.title}
                </h2>
                <button
                  type="button"
                  onClick={() => setIsEditingName(true)}
                  aria-label="Rename document"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#505A66] hover:bg-[#EAF3FC] hover:text-[#173B65]"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-[#505A66] tabular-nums truncate">
                {formatScanDateTime(document.createdAt)} · {document.pageCount}{' '}
                {document.pageCount === 1 ? 'page' : 'pages'} ·{' '}
                {formatBytes(document.estimatedSizeBytes)}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasAnyOcrText && (
            <button
              type="button"
              onClick={() => setShowOcrText((prev) => !prev)}
              className={`min-h-[44px] px-3 rounded-xl text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                showOcrText
                  ? 'bg-[#173B65] text-white'
                  : 'bg-[#EAF3FC] text-[#173B65] hover:bg-[#DCEBFA]'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Text</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            aria-label="Delete document"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Inline Delete Confirmation */}
      {confirmDelete && (
        <div className="bg-red-50 border-b border-red-200 px-4 sm:px-6 py-3">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm font-medium text-red-800">
              Delete &ldquo;{document.title}&rdquo; permanently from this device?
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-white text-[#252525] border border-red-200 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={busyAction === 'delete'}
                className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
              >
                {busyAction === 'delete' ? 'Deleting...' : 'Delete Document'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Banner */}
      {statusMessage && (
        <div
          className={`px-4 py-2.5 text-sm border-b ${
            statusMessage.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-[#EAF3FC] border-[#B9D2EC] text-[#173B65]'
          }`}
        >
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            {statusMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0" />
            ) : (
              <Check className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        </div>
      )}

      {/* Main Document Page Stage */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col items-center justify-center bg-[#EEF4FA]">
        {showOcrText ? (
          <div className="max-w-2xl w-full bg-white rounded-2xl border border-[#DCE8F6] shadow-sm p-5 sm:p-6 space-y-4 max-h-[65vh] flex flex-col">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-[#173B65]">
                  Recognized Text {document.pages.length > 1 ? `(Page ${activePageIdx + 1})` : ''}
                </h3>
                <p className="text-xs text-[#505A66]">
                  Embedded inside your PDF for search and text selection
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopyText}
                className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#EAF3FC] text-[#173B65] hover:bg-[#DCEBFA] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedText ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedText ? 'Copied' : 'Copy All Text'}</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto rounded-xl bg-[#F7FAFD] border border-[#EAF3FC] p-4 text-sm text-[#252525] whitespace-pre-wrap leading-relaxed select-text">
              {currentPageText || 'No readable text detected on this page.'}
            </div>
          </div>
        ) : (
          currentPage && (
            <div className="max-w-3xl w-full flex flex-col items-center">
              <div className="bg-white p-2 sm:p-3 rounded-2xl shadow-lg border border-[#DCE8F6] max-h-[60vh] flex items-center justify-center">
                <img
                  src={currentPage.processedDataUrl}
                  alt={`${document.title} — Page ${activePageIdx + 1}`}
                  className="max-h-[56vh] w-auto object-contain rounded-lg"
                />
              </div>

              {document.pages.length > 1 && (
                <div className="mt-4 flex items-center gap-2.5 overflow-x-auto max-w-full py-1 px-2">
                  {document.pages.map((p, idx) => {
                    const selected = idx === activePageIdx;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActivePageIdx(idx)}
                        className={`relative shrink-0 w-14 h-[72px] rounded-xl overflow-hidden border-2 transition-all ${
                          selected
                            ? 'border-[#173B65] ring-2 ring-[#173B65]/25 scale-105'
                            : 'border-white opacity-75 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={p.processedDataUrl}
                          alt={`Page ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-0.5 right-0.5 px-1.5 py-0.5 rounded bg-[#173B65]/85 text-white text-[10px] font-semibold tabular-nums">
                          {idx + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {/* Bottom Export Actions */}
      <footer className="px-4 sm:px-6 py-3.5 pb-safe bg-white border-t border-[#DCE8F6]">
        <div className="max-w-xl mx-auto grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleShare}
            disabled={busyAction !== null}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#EAF3FC] hover:bg-[#DCEBFA] text-[#173B65] font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap"
          >
            <Share2 className="w-4 h-4" />
            <span>{busyAction === 'share' ? 'Preparing...' : 'Share PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={busyAction !== null}
            className="min-h-[48px] px-4 py-2.5 rounded-xl bg-[#173B65] hover:bg-[#1E4C82] text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>{busyAction === 'download' ? 'Exporting...' : 'Download PDF'}</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
