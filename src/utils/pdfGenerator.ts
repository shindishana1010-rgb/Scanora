import { jsPDF } from 'jspdf';
import { OcrWord, PdfQuality, ScannedPage } from '../types/paperscan';
import { loadImage } from './imageProcessing';

const QUALITY_CONFIG: Record<PdfQuality, { maxPx: number; jpegQuality: number }> = {
  [PdfQuality.High]: { maxPx: 2200, jpegQuality: 0.93 },
  [PdfQuality.Medium]: { maxPx: 1600, jpegQuality: 0.82 },
  [PdfQuality.Low]: { maxPx: 1150, jpegQuality: 0.65 },
};

export interface GeneratedPdfResult {
  blob: Blob;
  filename: string;
  byteSize: number;
}

function sanitizeFilename(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ');
  const base = cleaned || 'PaperScan-Document';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

async function prepareImageForPdf(
  dataUrl: string,
  quality: PdfQuality
): Promise<{ jpegDataUrl: string; width: number; height: number }> {
  const cfg = QUALITY_CONFIG[quality];
  const img = await loadImage(dataUrl);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;

  const scale = Math.min(1, cfg.maxPx / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize canvas for PDF rendering.');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  return {
    jpegDataUrl: canvas.toDataURL('image/jpeg', cfg.jpegQuality),
    width: w,
    height: h,
  };
}

/**
 * Renders an invisible selectable & searchable OCR text layer aligned
 * directly over the scanned image region in the PDF.
 */
function renderSearchableOcrLayer(
  doc: jsPDF,
  words: OcrWord[] | undefined,
  offsetX: number,
  offsetY: number,
  drawW: number,
  drawH: number
): void {
  if (!words || words.length === 0) return;

  doc.setFont('helvetica', 'normal');

  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;

    const boxW = Math.max(0.5, (word.x1 - word.x0) * drawW);
    const boxH = Math.max(1.2, (word.y1 - word.y0) * drawH);
    const wx = offsetX + word.x0 * drawW;
    // Place baseline at ~85% of the bounding box height for accurate text selection
    const wy = offsetY + (word.y0 + (word.y1 - word.y0) * 0.85) * drawH;

    let fontSizePt = Math.max(4, Math.min(64, boxH * 2.83465 * 0.92));
    doc.setFontSize(fontSizePt);

    // Scale font down slightly if Helvetica metric exceeds bounding box width
    const measuredW = doc.getTextWidth(text);
    if (measuredW > boxW * 1.12 && measuredW > 0) {
      fontSizePt = Math.max(3.5, fontSizePt * ((boxW * 1.05) / measuredW));
      doc.setFontSize(fontSizePt);
    }

    doc.text(text, wx, wy, {
      renderingMode: 'invisible',
    });
  }
}

/**
 * Generates a clean, white-background, searchable A4 PDF document
 * preserving page proportions and embedding any OCR text layer.
 */
export async function generatePdfFromPages(
  title: string,
  pages: ScannedPage[],
  quality: PdfQuality
): Promise<GeneratedPdfResult> {
  if (!pages || pages.length === 0) {
    throw new Error('Add at least one scanned page before creating a PDF.');
  }

  try {
    const firstPage = await prepareImageForPdf(pages[0].processedDataUrl, quality);
    const firstOrientation = firstPage.width > firstPage.height ? 'landscape' : 'portrait';

    const doc = new jsPDF({
      orientation: firstOrientation,
      unit: 'mm',
      format: 'a4',
      compress: true,
    });

    doc.setProperties({
      title,
      subject: 'Scanned Document',
      creator: 'PaperScan',
    });

    const addCleanDocumentPage = (
      prepared: { jpegDataUrl: string; width: number; height: number },
      sourcePage: ScannedPage,
      isFirst: boolean
    ) => {
      const orientation = prepared.width > prepared.height ? 'landscape' : 'portrait';
      if (!isFirst) {
        doc.addPage('a4', orientation);
      }

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      // Explicit crisp white A4 sheet background
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pageW, pageH, 'F');

      const margin = 8; // Clean 8mm document margin
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;

      const imgRatio = prepared.width / prepared.height;
      const boxRatio = availW / availH;

      let drawW = availW;
      let drawH = availH;
      if (imgRatio > boxRatio) {
        drawW = availW;
        drawH = availW / imgRatio;
      } else {
        drawH = availH;
        drawW = availH * imgRatio;
      }

      const offsetX = (pageW - drawW) / 2;
      const offsetY = (pageH - drawH) / 2;

      doc.addImage(
        prepared.jpegDataUrl,
        'JPEG',
        offsetX,
        offsetY,
        drawW,
        drawH,
        undefined,
        'FAST'
      );

      // Embed invisible selectable/searchable OCR text layer aligned over the scan
      renderSearchableOcrLayer(
        doc,
        sourcePage.ocrWords,
        offsetX,
        offsetY,
        drawW,
        drawH
      );
    };

    addCleanDocumentPage(firstPage, pages[0], true);

    for (let i = 1; i < pages.length; i++) {
      const prepared = await prepareImageForPdf(pages[i].processedDataUrl, quality);
      addCleanDocumentPage(prepared, pages[i], false);
    }

    const blob = doc.output('blob');
    const filename = sanitizeFilename(title);

    return {
      blob,
      filename,
      byteSize: blob.size,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'An unexpected error occurred while building the PDF.';
    throw new Error(`PDF generation failed: ${message}`);
  }
}

export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Attempts native Web Share API with the PDF file; falls back to download
 * when file sharing is unsupported on the current browser.
 */
export async function shareOrDownloadPdf(
  blob: Blob,
  filename: string,
  title: string
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: 'application/pdf' });

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        title,
        text: `Scanned with PaperScan: ${title}`,
        files: [file],
      });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  downloadPdfBlob(blob, filename);
  return 'downloaded';
}
