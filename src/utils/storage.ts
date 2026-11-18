import { AppSettings, PdfQuality, ScannedDocument, ScannedPage } from '../types/paperscan';

const DB_NAME = 'paperscan_local_db';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const SETTINGS_KEY = 'paperscan_settings_v1';

export const DEFAULT_SETTINGS: AppSettings = {
  defaultQuality: PdfQuality.High,
  autoDetectEdges: true,
  enableOcr: true,
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Local database storage is unavailable in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error('Could not open local document storage on this device.'));
  });
}

export async function getAllDocuments(): Promise<ScannedDocument[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const items = (request.result as ScannedDocument[]) || [];
      items.sort((a, b) => b.createdAt - a.createdAt);
      resolve(items);
    };
    request.onerror = () => reject(new Error('Failed to load saved documents.'));
  });
}

/**
 * Inserts a brand-new document without ever overwriting an existing record.
 */
export async function insertNewDocument(doc: ScannedDocument): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(doc);

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new Error('Failed to save new document locally. Device storage may be full.'));
  });
}

/**
 * Updates an explicitly selected existing document (e.g. rename).
 */
export async function updateExistingDocument(doc: ScannedDocument): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(doc);

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(new Error('Failed to update document locally.'));
  });
}

export async function deleteDocumentById(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Failed to delete document.'));
  });
}

export async function clearAllDocuments(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Failed to clear saved documents.'));
  });
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      defaultQuality:
        parsed.defaultQuality && Object.values(PdfQuality).includes(parsed.defaultQuality)
          ? parsed.defaultQuality
          : DEFAULT_SETTINGS.defaultQuality,
      autoDetectEdges:
        typeof parsed.autoDetectEdges === 'boolean'
          ? parsed.autoDetectEdges
          : DEFAULT_SETTINGS.autoDetectEdges,
      enableOcr:
        typeof parsed.enableOcr === 'boolean'
          ? parsed.enableOcr
          : DEFAULT_SETTINGS.enableOcr,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors for small preference object
  }
}

export function estimateDocumentBytes(pages: ScannedPage[], quality: PdfQuality): number {
  const qualityFactor =
    quality === PdfQuality.High ? 1.0 : quality === PdfQuality.Medium ? 0.62 : 0.38;

  let totalBase64Len = 0;
  for (const page of pages) {
    totalBase64Len += page.processedDataUrl.length;
  }
  const rawImageBytes = totalBase64Len * 0.72;
  return Math.max(12000, Math.round(rawImageBytes * qualityFactor + 4500));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function formatScanDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatScanDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function extractSensibleTitleFromOcr(ocrText?: string): string | null {
  if (!ocrText) return null;
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\w\s\-.,&()#]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4 && line.length <= 44);

  for (const line of lines) {
    const letterCount = (line.match(/[a-zA-Z]/g) || []).length;
    if (letterCount >= 3) {
      return line;
    }
  }
  return null;
}

/**
 * Generates a sensible, filesystem-safe, collision-free document title
 * that will never overwrite an existing saved document.
 */
export function generateUniqueDocumentTitle(
  existingDocs: ScannedDocument[],
  ocrText?: string
): string {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10);
  const timeStamp = now
    .toTimeString()
    .slice(0, 5)
    .replace(':', '-');

  const ocrCandidate = extractSensibleTitleFromOcr(ocrText);
  const baseTitle = ocrCandidate
    ? `${ocrCandidate} (${dateStamp})`
    : `PaperScan ${dateStamp} ${timeStamp}`;

  const existingTitles = new Set(
    existingDocs.map((d) => d.title.trim().toLowerCase())
  );

  if (!existingTitles.has(baseTitle.toLowerCase())) {
    return baseTitle;
  }

  let counter = 2;
  while (existingTitles.has(`${baseTitle} (${counter})`.toLowerCase())) {
    counter++;
  }
  return `${baseTitle} (${counter})`;
}

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
