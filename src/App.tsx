import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  FolderOpen,
  Home,
  Settings,
  X,
} from 'lucide-react';
import {
  AppSettings,
  EnhancementFilter,
  NavTab,
  ScannedDocument,
  ScannedPage,
} from './types/paperscan';
import {
  clearAllDocuments,
  createId,
  deleteDocumentById,
  generateUniqueDocumentTitle,
  getAllDocuments,
  getSettings,
  insertNewDocument,
  saveSettings,
  updateExistingDocument,
} from './utils/storage';
import {
  autoConvertPhotoToCleanScan,
  createThumbnail,
  normalizeCapturedImage,
  readFileAsDataUrl,
} from './utils/imageProcessing';
import { runPageOcr } from './utils/ocr';
import { downloadPdfBlob, generatePdfFromPages } from './utils/pdfGenerator';
import { PaperScanLogo } from './components/PaperScanLogo';
import { HomeView } from './components/HomeView';
import { DocumentsView } from './components/DocumentsView';
import { SettingsView } from './components/SettingsView';
import { ScannerModal } from './components/ScannerModal';
import { DocumentViewerModal } from './components/DocumentViewerModal';

interface ProcessingProgress {
  active: boolean;
  percent: number;
  label: string;
  detail: string;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>(NavTab.Home);
  const [documents, setDocuments] = useState<ScannedDocument[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(true);
  const [storageError, setStorageError] = useState<string>('');
  const [settings, setSettings] = useState<AppSettings>(() => getSettings());

  const [isScannerOpen, setIsScannerOpen] = useState<boolean>(false);
  const [viewingDocumentId, setViewingDocumentId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProcessingProgress>({
    active: false,
    percent: 0,
    label: '',
    detail: '',
  });
  const [errorBanner, setErrorBanner] = useState<string>('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToast({ type, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const loadStoredDocuments = useCallback(async () => {
    setIsLoadingDocs(true);
    setStorageError('');
    try {
      const docs = await getAllDocuments();
      setDocuments(docs);
    } catch (err) {
      setStorageError(
        err instanceof Error
          ? err.message
          : 'Could not read saved documents from device storage.'
      );
    } finally {
      setIsLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    loadStoredDocuments();
  }, [loadStoredDocuments]);

  const handleUpdateSettings = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  };

  /**
   * Automatically converts one or more captured/imported photos into a clean,
   * edge-cropped, straightened, shadow-free, searchable OCR PDF document,
   * saves it with a unique non-overwriting filename, and downloads it.
   */
  const convertAndAutoSavePdf = useCallback(
    async (imageDataUrls: string[]) => {
      if (imageDataUrls.length === 0) return;

      setIsScannerOpen(false);
      setErrorBanner('');
      const total = imageDataUrls.length;
      setProgress({
        active: true,
        percent: 8,
        label: 'Enhancing Document...',
        detail: `Detecting edges and cleaning page 1 of ${total}`,
      });

      try {
        const processedPages: ScannedPage[] = [];

        for (let i = 0; i < total; i++) {
          const pageNum = i + 1;
          const basePct = Math.round((i / total) * 75);

          setProgress({
            active: true,
            percent: Math.max(10, basePct + 10),
            label: 'Cleaning & Straightening...',
            detail: `Cropping edges and removing shadows (page ${pageNum} of ${total})`,
          });

          const scan = await autoConvertPhotoToCleanScan(
            imageDataUrls[i],
            settings.autoDetectEdges,
            2000
          );

          let ocrText = '';
          let ocrWords: ScannedPage['ocrWords'] = [];

          if (settings.enableOcr) {
            setProgress({
              active: true,
              percent: Math.min(82, basePct + Math.round(45 / total)),
              label: 'Recognizing Text (OCR)...',
              detail: `Making text searchable on page ${pageNum} of ${total}`,
            });
            const ocrRes = await runPageOcr(
              scan.processedDataUrl,
              scan.width,
              scan.height
            );
            ocrText = ocrRes.text;
            ocrWords = ocrRes.words;
          }

          processedPages.push({
            id: createId('page'),
            originalDataUrl: scan.originalDataUrl,
            processedDataUrl: scan.processedDataUrl,
            corners: scan.corners,
            rotation: 0,
            filter: EnhancementFilter.Auto,
            brightness: 0,
            contrast: 0,
            width: scan.width,
            height: scan.height,
            ocrText,
            ocrWords,
          });
        }

        setProgress({
          active: true,
          percent: 88,
          label: 'Creating PDF Document...',
          detail: 'Fitting content onto clean white A4 pages',
        });

        const latestDocs = await getAllDocuments().catch(() => documents);
        const title = generateUniqueDocumentTitle(
          latestDocs,
          processedPages[0]?.ocrText
        );
        const pdf = await generatePdfFromPages(
          title,
          processedPages,
          settings.defaultQuality
        );
        const thumb = await createThumbnail(processedPages[0].processedDataUrl, 380);

        setProgress({
          active: true,
          percent: 96,
          label: 'Saving PDF...',
          detail: `Saving ${pdf.filename} to My Documents`,
        });

        const now = Date.now();
        const newDoc: ScannedDocument = {
          id: createId('doc'),
          title,
          createdAt: now,
          updatedAt: now,
          pageCount: processedPages.length,
          quality: settings.defaultQuality,
          pages: processedPages,
          thumbnailDataUrl: thumb,
          estimatedSizeBytes: pdf.byteSize,
        };

        await insertNewDocument(newDoc);
        downloadPdfBlob(pdf.blob, pdf.filename);

        setDocuments((prev) => [newDoc, ...prev]);
        setActiveTab(NavTab.Documents);
        showToast('success', `Saved ${pdf.filename} automatically.`);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Scanning or PDF creation failed. Please try again with clearer lighting.';
        setErrorBanner(message);
        showToast('error', message);
      } finally {
        setProgress({
          active: false,
          percent: 0,
          label: '',
          detail: '',
        });
      }
    },
    [
      documents,
      settings.autoDetectEdges,
      settings.defaultQuality,
      settings.enableOcr,
      showToast,
    ]
  );

  const handleImportFileList = async (files: FileList) => {
    setErrorBanner('');
    setProgress({
      active: true,
      percent: 5,
      label: 'Loading Photos...',
      detail: `Preparing ${files.length} ${files.length === 1 ? 'image' : 'images'}`,
    });

    try {
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const raw = await readFileAsDataUrl(files[i]);
        const normalized = await normalizeCapturedImage(raw);
        urls.push(normalized);
      }
      await convertAndAutoSavePdf(urls);
    } catch (err) {
      setProgress({ active: false, percent: 0, label: '', detail: '' });
      const message =
        err instanceof Error ? err.message : 'Could not read the selected image files.';
      setErrorBanner(message);
      showToast('error', message);
    }
  };

  const handleRenameDocument = async (id: string, newTitle: string) => {
    const existing = documents.find((d) => d.id === id);
    if (!existing) return;
    const trimmed = newTitle.trim();
    if (!trimmed) {
      throw new Error('Document name cannot be empty.');
    }

    const collision = documents.some(
      (d) => d.id !== id && d.title.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (collision) {
      throw new Error(
        `A document named "${trimmed}" already exists. Choose a different name to avoid confusion.`
      );
    }

    const updated: ScannedDocument = {
      ...existing,
      title: trimmed,
      updatedAt: Date.now(),
    };
    await updateExistingDocument(updated);
    setDocuments((prev) => prev.map((d) => (d.id === id ? updated : d)));
  };

  const handleDeleteDocument = async (id: string) => {
    await deleteDocumentById(id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    if (viewingDocumentId === id) {
      setViewingDocumentId(null);
    }
  };

  const handleClearAllDocuments = async () => {
    await clearAllDocuments();
    setDocuments([]);
    setViewingDocumentId(null);
  };

  const viewingDocument =
    documents.find((d) => d.id === viewingDocumentId) || null;

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#252525]">
      {/* Top Navigation Bar */}
      <header className="lg:sticky lg:top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#DCE8F6]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 lg:h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab(NavTab.Home)}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#173B65] rounded-lg"
          >
            <PaperScanLogo size={32} />
            <span className="font-display text-lg font-bold tracking-tight text-[#173B65]">
              PaperScan
            </span>
          </button>

          <nav
            aria-label="Primary Navigation"
            className="hidden lg:flex items-center gap-8"
          >
            {[
              { id: NavTab.Home, label: 'Home' },
              { id: NavTab.Documents, label: 'My Documents' },
              { id: NavTab.Settings, label: 'Settings' },
            ].map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative py-2 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-[#173B65]'
                      : 'text-[#505A66] hover:text-[#173B65]'
                  }`}
                >
                  {item.label}
                  {active && (
                    <span className="absolute left-0 right-0 -bottom-[1px] h-[2px] bg-[#173B65] rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#173B65] hover:bg-[#1E4C82] text-white text-xs sm:text-sm font-semibold transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4" />
              <span>Scan Document</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-12">
        {storageError && (
          <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>{storageError}</span>
          </div>
        )}

        {errorBanner && (
          <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
              <div>
                <p className="font-semibold">Scan Error</p>
                <p className="mt-0.5">{errorBanner}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner('')}
              aria-label="Dismiss error"
              className="p-1.5 rounded-lg hover:bg-red-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeTab === NavTab.Home && (
          <HomeView
            documents={documents}
            isLoading={isLoadingDocs}
            onStartScan={() => setIsScannerOpen(true)}
            onImportFiles={handleImportFileList}
            onOpenDocument={(doc) => setViewingDocumentId(doc.id)}
            onNavigateToDocuments={() => setActiveTab(NavTab.Documents)}
          />
        )}

        {activeTab === NavTab.Documents && (
          <DocumentsView
            documents={documents}
            isLoading={isLoadingDocs}
            onStartScan={() => setIsScannerOpen(true)}
            onOpenDocument={(doc) => setViewingDocumentId(doc.id)}
            onRenameDocument={handleRenameDocument}
            onDeleteDocument={handleDeleteDocument}
          />
        )}

        {activeTab === NavTab.Settings && (
          <SettingsView
            settings={settings}
            documents={documents}
            onUpdateSettings={handleUpdateSettings}
            onClearAllDocuments={handleClearAllDocuments}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Tab Bar */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-[#DCE8F6]"
      >
        <div className="grid grid-cols-3 h-16 pb-safe">
          {[
            { id: NavTab.Home, label: 'Home', Icon: Home },
            { id: NavTab.Documents, label: 'My Documents', Icon: FolderOpen },
            { id: NavTab.Settings, label: 'Settings', Icon: Settings },
          ].map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-[#173B65]' : 'text-[#6B7785] hover:text-[#173B65]'
                }`}
              >
                <Icon
                  className={`w-5 h-5 ${active ? 'stroke-[2.4]' : 'stroke-[1.9]'}`}
                />
                <span className="text-[11px] font-semibold tracking-tight whitespace-nowrap">
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Clean Progress Indicator Overlay */}
      {progress.active && (
        <div
          className="fixed inset-0 z-50 bg-[#0F243E]/65 backdrop-blur-xs flex items-center justify-center p-6"
          role="status"
          aria-live="polite"
        >
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#EAF3FC] text-[#173B65] flex items-center justify-center shrink-0">
                  <Camera className="w-5 h-5 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-base font-bold text-[#173B65] truncate">
                    {progress.label}
                  </p>
                  <p className="text-xs text-[#505A66] truncate">
                    {progress.detail}
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-[#173B65] tabular-nums shrink-0">
                {progress.percent}%
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-[#EAF3FC] overflow-hidden">
              <div
                className="h-full bg-[#173B65] rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {toast && (
        <div className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-40 px-4 w-full max-w-md pointer-events-none">
          <div
            className={`pointer-events-auto rounded-2xl px-4 py-3 shadow-lg border flex items-center justify-between gap-3 text-sm font-medium ${
              toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-[#173B65] border-[#173B65] text-white'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {toast.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <Check className="w-4 h-4 shrink-0" />
              )}
              <span className="truncate">{toast.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Close notification"
              className="p-1 rounded-lg hover:bg-white/15 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Scanner Modal */}
      <ScannerModal
        isOpen={isScannerOpen}
        autoDetectEdges={settings.autoDetectEdges}
        onClose={() => setIsScannerOpen(false)}
        onCaptureComplete={convertAndAutoSavePdf}
      />

      {/* Saved Document Viewer */}
      <DocumentViewerModal
        document={viewingDocument}
        onClose={() => setViewingDocumentId(null)}
        onRename={handleRenameDocument}
        onDelete={handleDeleteDocument}
      />
    </div>
  );
}
