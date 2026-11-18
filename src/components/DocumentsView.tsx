import React, { useMemo, useState } from 'react';
import {
  Camera,
  Check,
  Download,
  Edit3,
  FileText,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { ScannedDocument } from '../types/paperscan';
import { formatBytes, formatScanDate } from '../utils/storage';
import {
  downloadPdfBlob,
  generatePdfFromPages,
  shareOrDownloadPdf,
} from '../utils/pdfGenerator';

type SortOption = 'newest' | 'oldest' | 'name';

interface DocumentsViewProps {
  documents: ScannedDocument[];
  isLoading: boolean;
  onStartScan: () => void;
  onOpenDocument: (doc: ScannedDocument) => void;
  onRenameDocument: (id: string, newTitle: string) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({
  documents,
  isLoading,
  onStartScan,
  onOpenDocument,
  onRenameDocument,
  onDeleteDocument,
}) => {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const filteredDocuments = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? documents.filter(
          (d) =>
            d.title.toLowerCase().includes(q) ||
            d.pages.some((p) => (p.ocrText || '').toLowerCase().includes(q))
        )
      : [...documents];

    list.sort((a, b) => {
      if (sortBy === 'oldest') return a.createdAt - b.createdAt;
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [documents, query, sortBy]);

  const handleRenameSubmit = async (id: string) => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    try {
      await onRenameDocument(id, trimmed);
      setRenamingId(null);
      setFeedback({ type: 'success', text: 'Document renamed.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not rename document.',
      });
    }
  };

  const handleDownload = async (doc: ScannedDocument) => {
    if (busyId) return;
    setBusyId(doc.id);
    setFeedback(null);
    try {
      const pdf = await generatePdfFromPages(doc.title, doc.pages, doc.quality);
      downloadPdfBlob(pdf.blob, pdf.filename);
      setFeedback({
        type: 'success',
        text: `Saved ${pdf.filename} to your device.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to export PDF.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleShare = async (doc: ScannedDocument) => {
    if (busyId) return;
    setBusyId(doc.id);
    setFeedback(null);
    try {
      const pdf = await generatePdfFromPages(doc.title, doc.pages, doc.quality);
      const res = await shareOrDownloadPdf(pdf.blob, pdf.filename, doc.title);
      if (res === 'shared') {
        setFeedback({ type: 'success', text: `Shared ${doc.title}.` });
      } else if (res === 'downloaded') {
        setFeedback({
          type: 'success',
          text: `Downloaded ${pdf.filename} for sharing.`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to share PDF.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setFeedback(null);
    try {
      await onDeleteDocument(id);
      setConfirmDeleteId(null);
      setFeedback({ type: 'success', text: 'Document removed.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not delete document.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#173B65]">
            My Documents
          </h1>
          <p className="text-sm text-[#505A66] tabular-nums">
            {documents.length}{' '}
            {documents.length === 1 ? 'document' : 'documents'} saved on this
            device
          </p>
        </div>

        <button
          type="button"
          onClick={onStartScan}
          className="min-h-[46px] px-5 py-2.5 rounded-xl bg-[#173B65] hover:bg-[#1E4C82] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
        >
          <Camera className="w-4 h-4" />
          <span>New Scan</span>
        </button>
      </div>

      {/* Search & Sort Controls */}
      {documents.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#6B7785] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search saved documents..."
              aria-label="Search saved documents"
              className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl border border-[#DCE8F6] bg-white text-sm text-[#252525] focus:outline-none focus:border-[#173B65]"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#EAF3FC] self-start sm:self-auto">
            {(
              [
                { id: 'newest', label: 'Newest' },
                { id: 'oldest', label: 'Oldest' },
                { id: 'name', label: 'Name' },
              ] as { id: SortOption; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSortBy(opt.id)}
                className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  sortBy === opt.id
                    ? 'bg-white text-[#173B65] shadow-sm'
                    : 'text-[#505A66] hover:text-[#173B65]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl text-sm border flex items-center justify-between gap-2 ${
            feedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-[#EAF3FC] border-[#B9D2EC] text-[#173B65]'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss message"
            className="p-1 rounded-lg hover:bg-black/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Documents List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-44 rounded-2xl bg-[#F4F7FA] animate-pulse border border-[#EAF3FC]"
            />
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE8F6] bg-white p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#EAF3FC] text-[#173B65] flex items-center justify-center mx-auto mb-4">
            <FileText className="w-7 h-7" />
          </div>
          <h2 className="font-display text-lg font-bold text-[#173B65]">
            Your library is empty
          </h2>
          <p className="text-sm text-[#505A66] mt-1 max-w-sm mx-auto">
            Scanned PDFs you save will appear here for viewing, renaming, and
            sharing anytime.
          </p>
          <button
            type="button"
            onClick={onStartScan}
            className="mt-5 min-h-[46px] px-5 py-2.5 rounded-xl bg-[#173B65] text-white text-sm font-semibold hover:bg-[#1E4C82] inline-flex items-center gap-2"
          >
            <Camera className="w-4 h-4" />
            <span>Scan Your First Document</span>
          </button>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE8F6] bg-white p-8 text-center">
          <p className="font-display text-base font-semibold text-[#173B65]">
            No matching documents
          </p>
          <p className="text-sm text-[#505A66] mt-1">
            Try searching with a different keyword.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocuments.map((doc) => {
            const isRenaming = renamingId === doc.id;
            const isConfirmingDelete = confirmDeleteId === doc.id;

            return (
              <article
                key={doc.id}
                className="rounded-2xl bg-white border border-[#DCE8F6] p-4 flex flex-col justify-between gap-3.5 hover:border-[#173B65]/40 transition-colors"
              >
                {/* Top Preview + Title */}
                <div className="flex items-start gap-3.5">
                  <button
                    type="button"
                    onClick={() => onOpenDocument(doc)}
                    className="w-20 h-24 rounded-xl bg-[#F2F6FA] border border-[#EAF3FC] overflow-hidden shrink-0 flex items-center justify-center focus-visible:outline-2 focus-visible:outline-[#173B65]"
                    aria-label={`Preview ${doc.title}`}
                  >
                    {doc.thumbnailDataUrl ? (
                      <img
                        src={doc.thumbnailDataUrl}
                        alt={doc.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <FileText className="w-7 h-7 text-[#173B65]" />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameSubmit(doc.id);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          autoFocus
                          maxLength={80}
                          className="w-full min-h-[38px] px-2.5 py-1 rounded-lg border border-[#173B65] text-sm font-medium focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameSubmit(doc.id)}
                          aria-label="Save name"
                          className="min-h-[38px] min-w-[38px] rounded-lg bg-[#173B65] text-white flex items-center justify-center shrink-0"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenDocument(doc)}
                        className="text-left w-full group"
                      >
                        <h3 className="font-display text-base font-bold text-[#252525] group-hover:text-[#173B65] truncate">
                          {doc.title}
                        </h3>
                      </button>
                    )}

                    <p className="text-xs text-[#505A66] mt-1 tabular-nums">
                      {formatScanDate(doc.createdAt)} · {doc.pageCount}{' '}
                      {doc.pageCount === 1 ? 'page' : 'pages'}
                    </p>
                    <p className="text-xs text-[#6B7785] mt-0.5 tabular-nums capitalize">
                      {doc.quality} quality · {formatBytes(doc.estimatedSizeBytes)}
                    </p>
                  </div>
                </div>

                {/* Delete confirmation bar or action buttons */}
                {isConfirmingDelete ? (
                  <div className="pt-3 border-t border-[#F1F5FA] flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-red-700">
                      Delete permanently?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[38px] px-3 rounded-lg bg-[#F4F7FA] text-xs font-semibold text-[#252525]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        disabled={busyId === doc.id}
                        className="min-h-[38px] px-3 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-3 border-t border-[#F1F5FA] flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      disabled={busyId === doc.id}
                      className="flex-1 min-h-[42px] px-2.5 rounded-xl bg-[#EAF3FC] text-[#173B65] hover:bg-[#173B65] hover:text-white transition-colors text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleShare(doc)}
                      disabled={busyId === doc.id}
                      aria-label={`Share ${doc.title}`}
                      title="Share PDF"
                      className="min-h-[42px] min-w-[42px] rounded-xl bg-[#F4F7FA] text-[#173B65] hover:bg-[#EAF3FC] transition-colors flex items-center justify-center"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(doc.id);
                        setDraftName(doc.title);
                        setConfirmDeleteId(null);
                      }}
                      aria-label={`Rename ${doc.title}`}
                      title="Rename"
                      className="min-h-[42px] min-w-[42px] rounded-xl bg-[#F4F7FA] text-[#252525] hover:bg-[#EAF3FC] hover:text-[#173B65] transition-colors flex items-center justify-center"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDeleteId(doc.id);
                        setRenamingId(null);
                      }}
                      aria-label={`Delete ${doc.title}`}
                      title="Delete"
                      className="min-h-[42px] min-w-[42px] rounded-xl bg-[#F4F7FA] text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
