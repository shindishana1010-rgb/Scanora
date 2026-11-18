import React, { useState } from 'react';
import {
  Check,
  Info,
  ShieldCheck,
  Sliders,
  Trash2,
} from 'lucide-react';
import { AppSettings, PdfQuality, ScannedDocument } from '../types/paperscan';
import { formatBytes } from '../utils/storage';
import { PaperScanLogo } from './PaperScanLogo';

interface SettingsViewProps {
  settings: AppSettings;
  documents: ScannedDocument[];
  onUpdateSettings: (next: AppSettings) => void;
  onClearAllDocuments: () => Promise<void>;
}

const QUALITY_OPTIONS: {
  id: PdfQuality;
  title: string;
  description: string;
}[] = [
  {
    id: PdfQuality.High,
    title: 'High Quality',
    description: 'Best for printing and fine text',
  },
  {
    id: PdfQuality.Medium,
    title: 'Medium',
    description: 'Balanced clarity and file size',
  },
  {
    id: PdfQuality.Low,
    title: 'Low (Compact)',
    description: 'Smallest PDF for fast sharing',
  },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  documents,
  onUpdateSettings,
  onClearAllDocuments,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const totalBytes = documents.reduce(
    (sum, doc) => sum + doc.estimatedSizeBytes,
    0
  );

  const handleConfirmClear = async () => {
    setIsClearing(true);
    try {
      await onClearAllDocuments();
      setConfirmClear(false);
      setStatusMessage('All saved documents have been cleared from this device.');
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Failed to clear saved documents.'
      );
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-[#173B65]">
          Settings
        </h1>
        <p className="text-sm text-[#505A66]">
          Customize automatic PDF quality, OCR text recognition, and local storage
        </p>
      </div>

      {statusMessage && (
        <div className="p-3.5 rounded-xl bg-[#EAF3FC] border border-[#B9D2EC] text-[#173B65] text-sm flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Default PDF Quality & Automatic Scanning Preferences */}
      <section className="rounded-2xl bg-white border border-[#DCE8F6] p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#EAF3FC] text-[#173B65] flex items-center justify-center shrink-0">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-[#173B65]">
              Default PDF Quality
            </h2>
            <p className="text-xs sm:text-sm text-[#505A66]">
              Applied automatically on every scan without interrupting your workflow
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {QUALITY_OPTIONS.map((opt) => {
            const active = settings.defaultQuality === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() =>
                  onUpdateSettings({ ...settings, defaultQuality: opt.id })
                }
                className={`min-h-[60px] p-3.5 rounded-xl border text-left transition-colors ${
                  active
                    ? 'bg-[#173B65] border-[#173B65] text-white'
                    : 'bg-[#F7FAFD] border-[#DCE8F6] text-[#252525] hover:bg-[#EAF3FC]'
                }`}
              >
                <div className="text-sm font-semibold">{opt.title}</div>
                <div
                  className={`text-xs mt-0.5 ${
                    active ? 'text-[#EAF3FC]' : 'text-[#505A66]'
                  }`}
                >
                  {opt.description}
                </div>
              </button>
            );
          })}
        </div>

        {/* Auto-detect edge toggle */}
        <div className="pt-4 border-t border-[#F1F5FA] flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[#252525]">
              Automatic Edge Cropping &amp; Straightening
            </div>
            <p className="text-xs text-[#505A66]">
              Automatically detect paper boundaries, remove desk backgrounds, and straighten pages
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.autoDetectEdges}
            onClick={() =>
              onUpdateSettings({
                ...settings,
                autoDetectEdges: !settings.autoDetectEdges,
              })
            }
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-[#173B65] ${
              settings.autoDetectEdges ? 'bg-[#173B65]' : 'bg-[#CBD8E6]'
            }`}
          >
            <span
              className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                settings.autoDetectEdges ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Searchable PDF OCR toggle */}
        <div className="pt-4 border-t border-[#F1F5FA] flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[#252525]">
              Searchable PDF Text (OCR)
            </div>
            <p className="text-xs text-[#505A66]">
              Recognize printed text so words inside generated PDFs can be searched and selected
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enableOcr}
            onClick={() =>
              onUpdateSettings({
                ...settings,
                enableOcr: !settings.enableOcr,
              })
            }
            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-[#173B65] ${
              settings.enableOcr ? 'bg-[#173B65]' : 'bg-[#CBD8E6]'
            }`}
          >
            <span
              className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${
                settings.enableOcr ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Storage & Clear Saved Documents */}
      <section className="rounded-2xl bg-white border border-[#DCE8F6] p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#EAF3FC] text-[#173B65] flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-[#173B65]">
                Local Storage
              </h2>
              <p className="text-xs sm:text-sm text-[#505A66] tabular-nums">
                {documents.length}{' '}
                {documents.length === 1 ? 'document' : 'documents'} saved ·{' '}
                {formatBytes(totalBytes)} used on device
              </p>
            </div>
          </div>
        </div>

        {!confirmClear ? (
          <button
            type="button"
            disabled={documents.length === 0}
            onClick={() => setConfirmClear(true)}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 text-sm font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
          >
            Clear Saved Documents
          </button>
        ) : (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-3">
            <p className="text-sm font-medium text-red-800">
              Remove all {documents.length} saved{' '}
              {documents.length === 1 ? 'document' : 'documents'} from this
              device? Any PDFs you already downloaded to your Downloads folder
              will remain safe.
            </p>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-white border border-red-200 text-sm font-semibold text-[#252525]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClear}
                disabled={isClearing}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
              >
                {isClearing ? 'Clearing...' : 'Yes, Clear All Documents'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Privacy Information */}
      <section className="rounded-2xl bg-white border border-[#DCE8F6] p-5 sm:p-6 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#EAF3FC] text-[#173B65] flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-[#173B65]">
              Privacy Information
            </h2>
            <p className="text-sm text-[#505A66] mt-1 leading-relaxed">
              PaperScan processes every camera capture, edge crop, shadow removal,
              OCR text recognition, and PDF export directly on your device. Your
              documents are never uploaded to external servers, and your saved
              library stays privately in your browser&apos;s local storage.
            </p>
          </div>
        </div>
      </section>

      {/* App Information */}
      <section className="rounded-2xl bg-[#EAF3FC]/65 border border-[#DCE8F6] p-5 sm:p-6 space-y-3">
        <div className="flex items-start gap-3">
          <PaperScanLogo size={40} className="shrink-0" />
          <div>
            <h2 className="font-display text-base font-bold text-[#173B65]">
              About PaperScan
            </h2>
            <p className="text-sm text-[#252525] mt-1 leading-relaxed">
              PaperScan automatically converts camera captures into clean,
              straightened, white-background searchable A4 PDF documents. Scan one
              page or combine multiple pages into a single PDF in seconds.
            </p>
            <div className="mt-3 flex items-start gap-2 text-xs text-[#505A66]">
              <Info className="w-4 h-4 text-[#173B65] shrink-0 mt-0.5" />
              <span>
                Tip: For the sharpest automatic corner cropping, place white
                paper on a darker surface in even lighting.
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
