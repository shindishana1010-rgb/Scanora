import React, { useRef, useState } from 'react';
import {
  Camera,
  ChevronRight,
  Download,
  FileText,
  ImagePlus,
  ScanLine,
} from 'lucide-react';
import { ScannedDocument } from '../types/paperscan';
import { formatBytes, formatScanDate } from '../utils/storage';
import { downloadPdfBlob, generatePdfFromPages } from '../utils/pdfGenerator';
import { PaperScanLogo } from './PaperScanLogo';

interface HomeViewProps {
  documents: ScannedDocument[];
  isLoading: boolean;
  onStartScan: () => void;
  onImportFiles: (files: FileList) => void;
  onOpenDocument: (doc: ScannedDocument) => void;
  onNavigateToDocuments: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  documents,
  isLoading,
  onStartScan,
  onImportFiles,
  onOpenDocument,
  onNavigateToDocuments,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string>('');

  const recentDocs = documents.slice(0, 6);
  const totalPages = documents.reduce((acc, doc) => acc + doc.pageCount, 0);

  const handleQuickDownload = async (
    e: React.MouseEvent,
    doc: ScannedDocument
  ) => {
    e.stopPropagation();
    if (downloadingId) return;
    setDownloadingId(doc.id);
    setExportError('');
    try {
      const pdf = await generatePdfFromPages(doc.title, doc.pages, doc.quality);
      downloadPdfBlob(pdf.blob, pdf.filename);
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Failed to generate PDF.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome & Primary Scan Action Card */}
      <section className="rounded-3xl bg-[#EAF3FC] border border-[#DCE8F6] p-6 sm:p-8 lg:p-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-8 space-y-4">
            <div className="flex items-center gap-3">
              <PaperScanLogo size={42} className="shrink-0" />
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#173B65] tracking-tight text-balance">
                  Welcome to PaperScan
                </h1>
                <p className="text-sm text-[#505A66]">
                  Fast, clear document scanning right on your device
                </p>
              </div>
            </div>

            <p className="text-sm sm:text-base text-[#252525] leading-relaxed max-w-2xl">
              Turn physical receipts, class notes, letters, and certificates into
              sharp, multi-page PDF files in seconds. Everything stays private on
              your device.
            </p>

            {/* Unboxed Clean Metrics */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-sm text-[#173B65]">
              <div className="tabular-nums">
                <span className="font-display font-bold text-lg">
                  {documents.length}
                </span>{' '}
                <span className="text-[#505A66]">
                  {documents.length === 1 ? 'saved document' : 'saved documents'}
                </span>
              </div>
              <span className="text-[#B9D2EC]" aria-hidden="true">
                ·
              </span>
              <div className="tabular-nums">
                <span className="font-display font-bold text-lg">{totalPages}</span>{' '}
                <span className="text-[#505A66]">
                  {totalPages === 1 ? 'page scanned' : 'pages scanned'}
                </span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-3">
            <button
              type="button"
              onClick={onStartScan}
              className="w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-[#173B65] hover:bg-[#1E4C82] active:scale-[0.99] text-white font-display font-semibold text-base transition-all shadow-md shadow-[#173B65]/15 flex items-center justify-center gap-2.5 whitespace-nowrap"
            >
              <Camera className="w-5 h-5" />
              <span>Scan Document</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full min-h-[48px] px-5 py-2.5 rounded-2xl bg-white hover:bg-[#F7FAFD] text-[#173B65] border border-[#DCE8F6] font-semibold text-sm transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <ImagePlus className="w-4 h-4" />
              <span>Import from Photos</span>
            </button>
          </div>
        </div>
      </section>

      {exportError && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          {exportError}
        </div>
      )}

      {/* My Documents / Recent Scans Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-[#173B65]">
              My Documents
            </h2>
            <p className="text-xs sm:text-sm text-[#505A66]">
              Recently scanned PDFs saved on this device
            </p>
          </div>

          {documents.length > 0 && (
            <button
              type="button"
              onClick={onNavigateToDocuments}
              className="min-h-[44px] px-3 py-2 rounded-xl text-sm font-semibold text-[#173B65] hover:bg-[#EAF3FC] transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>View All</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-28 rounded-2xl bg-[#F4F7FA] animate-pulse border border-[#EAF3FC]"
              />
            ))}
          </div>
        ) : recentDocs.length === 0 ? (
          <div className="rounded-2xl border border-[#DCE8F6] bg-white p-8 sm:p-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#EAF3FC] text-[#173B65] flex items-center justify-center mx-auto mb-4">
              <ScanLine className="w-7 h-7" />
            </div>
            <h3 className="font-display text-base sm:text-lg font-bold text-[#173B65]">
              No scanned documents yet
            </h3>
            <p className="text-sm text-[#505A66] mt-1.5 max-w-md mx-auto leading-relaxed">
              Tap <strong>Scan Document</strong> above to capture any paper —
              PaperScan automatically straightens edges, cleans the white
              background, and saves your PDF right away.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentDocs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => onOpenDocument(doc)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenDocument(doc);
                  }
                }}
                className="group cursor-pointer rounded-2xl bg-white border border-[#DCE8F6] hover:border-[#173B65]/40 hover:shadow-md transition-all p-3.5 flex items-center gap-3.5 focus-visible:outline-2 focus-visible:outline-[#173B65]"
              >
                <div className="w-16 h-20 rounded-xl bg-[#F2F6FA] border border-[#EAF3FC] overflow-hidden shrink-0 flex items-center justify-center">
                  {doc.thumbnailDataUrl ? (
                    <img
                      src={doc.thumbnailDataUrl}
                      alt={doc.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileText className="w-6 h-6 text-[#173B65]" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-sm sm:text-base font-semibold text-[#252525] group-hover:text-[#173B65] truncate">
                    {doc.title}
                  </h3>
                  <p className="text-xs text-[#505A66] mt-1 tabular-nums truncate">
                    {formatScanDate(doc.createdAt)} · {doc.pageCount}{' '}
                    {doc.pageCount === 1 ? 'page' : 'pages'}
                  </p>
                  <p className="text-xs text-[#6B7785] mt-0.5 tabular-nums">
                    {formatBytes(doc.estimatedSizeBytes)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={(e) => handleQuickDownload(e, doc)}
                  disabled={downloadingId === doc.id}
                  aria-label={`Download ${doc.title} as PDF`}
                  title="Download PDF"
                  className="min-h-[44px] min-w-[44px] rounded-xl bg-[#EAF3FC] text-[#173B65] hover:bg-[#173B65] hover:text-white transition-colors flex items-center justify-center shrink-0 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onImportFiles(e.target.files);
          }
          e.target.value = '';
        }}
        className="hidden"
      />
    </div>
  );
};
