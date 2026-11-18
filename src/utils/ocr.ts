import { createWorker, Worker } from 'tesseract.js';
import { OcrWord } from '../types/paperscan';

let sharedWorkerPromise: Promise<Worker> | null = null;

async function getSharedOcrWorker(): Promise<Worker> {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = createWorker('eng').catch((err) => {
      sharedWorkerPromise = null;
      throw err;
    });
  }
  return sharedWorkerPromise;
}

export interface PageOcrResult {
  text: string;
  words: OcrWord[];
}

/**
 * Runs client-side OCR on a cleaned scanned page image to extract searchable
 * text and normalized word bounding boxes for the invisible PDF text layer.
 * Fails softly if offline or unavailable so PDF creation always succeeds.
 */
export async function runPageOcr(
  processedDataUrl: string,
  imageWidth: number,
  imageHeight: number,
  timeoutMs = 22000
): Promise<PageOcrResult> {
  if (!imageWidth || !imageHeight) {
    return { text: '', words: [] };
  }

  try {
    const worker = await Promise.race([
      getSharedOcrWorker(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR initialization timed out')), timeoutMs)
      ),
    ]);

    const result = await Promise.race([
      worker.recognize(processedDataUrl, {}, { text: true, blocks: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OCR recognition timed out')), timeoutMs)
      ),
    ]);

    const words: OcrWord[] = [];
    const blocks = result.data.blocks || [];

    for (const block of blocks) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          for (const w of line.words || []) {
            const cleanText = (w.text || '').trim();
            if (!cleanText || w.confidence < 32) continue;

            const x0 = Math.max(0, Math.min(1, w.bbox.x0 / imageWidth));
            const y0 = Math.max(0, Math.min(1, w.bbox.y0 / imageHeight));
            const x1 = Math.max(0, Math.min(1, w.bbox.x1 / imageWidth));
            const y1 = Math.max(0, Math.min(1, w.bbox.y1 / imageHeight));

            if (x1 > x0 && y1 > y0) {
              words.push({
                text: cleanText,
                confidence: w.confidence,
                x0,
                y0,
                x1,
                y1,
              });
            }
          }
        }
      }
    }

    const cleanFullText = (result.data.text || '').trim();
    return {
      text: cleanFullText,
      words,
    };
  } catch {
    // Soft fallback: PDF still saves cleanly as a sharp visual scan
    return { text: '', words: [] };
  }
}
