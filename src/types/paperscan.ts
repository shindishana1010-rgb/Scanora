export enum NavTab {
  Home = 'home',
  Documents = 'documents',
  Settings = 'settings',
}

export enum EnhancementFilter {
  Original = 'original',
  Auto = 'auto',
  Grayscale = 'grayscale',
  BlackAndWhite = 'bw',
}

export enum PdfQuality {
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

export interface Point {
  /** Normalized coordinate in range [0, 1] relative to image width */
  x: number;
  /** Normalized coordinate in range [0, 1] relative to image height */
  y: number;
}

/** Four corners ordered clockwise: topLeft, topRight, bottomRight, bottomLeft */
export interface Corners {
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
}

export interface OcrWord {
  text: string;
  confidence: number;
  /** Normalized [0..1] bounding box relative to processed page dimensions */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScannedPage {
  id: string;
  originalDataUrl: string;
  processedDataUrl: string;
  corners: Corners;
  rotation: number;
  filter: EnhancementFilter;
  brightness: number;
  contrast: number;
  width: number;
  height: number;
  ocrText?: string;
  ocrWords?: OcrWord[];
}

export interface ScannedDocument {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
  quality: PdfQuality;
  pages: ScannedPage[];
  thumbnailDataUrl: string;
  estimatedSizeBytes: number;
}

export interface AppSettings {
  defaultQuality: PdfQuality;
  autoDetectEdges: boolean;
  enableOcr: boolean;
}
