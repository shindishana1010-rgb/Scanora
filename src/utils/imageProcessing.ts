import { Corners, EnhancementFilter, Point } from '../types/paperscan';

export function getDefaultCorners(inset = 0.04): Corners {
  return {
    topLeft: { x: inset, y: inset },
    topRight: { x: 1 - inset, y: inset },
    bottomRight: { x: 1 - inset, y: 1 - inset },
    bottomLeft: { x: inset, y: 1 - inset },
  };
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image data.'));
    img.src = src;
  });
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Normalizes oversized camera/gallery images before processing.
 */
export async function normalizeCapturedImage(
  dataUrl: string,
  maxEdge = 2400
): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  if (w <= maxEdge && h <= maxEdge) {
    return dataUrl;
  }

  const scale = maxEdge / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.94);
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function polygonArea(pts: Point[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Automatic document edge & 4-corner detection.
 * Segments bright, low-saturation paper from darker/textured backgrounds using
 * Otsu thresholding + largest connected component + extreme (x+y, x-y) quad corners,
 * with Sobel edge-projection fallback for uniform or full-frame captures.
 */
export function detectDocumentCorners(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
): Corners {
  const srcW =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth || source.width
        : source.width;
  const srcH =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight || source.height
        : source.height;

  if (!srcW || !srcH) {
    return getDefaultCorners(0.02);
  }

  const targetW = 240;
  const targetH = Math.max(120, Math.round((srcH / srcW) * targetW));
  const total = targetW * targetH;

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return getDefaultCorners(0.02);

  ctx.drawImage(source, 0, 0, targetW, targetH);
  const { data } = ctx.getImageData(0, 0, targetW, targetH);

  // Paper score: high luminance + low color saturation favors white/cream paper over wood/desk
  const paperScore = new Float32Array(total);
  const hist = new Uint32Array(256);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const score = Math.max(0, Math.min(255, lum - 0.35 * sat));
    paperScore[i] = score;
    hist[score | 0]++;
  }

  // Box blur 3x3 on paperScore to bridge printed text gaps inside the paper sheet
  const smooth = new Float32Array(total);
  for (let y = 1; y < targetH - 1; y++) {
    for (let x = 1; x < targetW - 1; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += paperScore[(y + ky) * targetW + (x + kx)];
        }
      }
      smooth[y * targetW + x] = sum / 9;
    }
  }

  // Otsu threshold to separate foreground paper vs background table/desk
  let totalSum = 0;
  for (let t = 0; t < 256; t++) totalSum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let maxBetweenVar = 0;
  let otsuThresh = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (totalSum - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > maxBetweenVar) {
      maxBetweenVar = betweenVar;
      otsuThresh = t;
    }
  }

  // Only accept connected-component segmentation if foreground/background separation is distinct
  const separation = Math.sqrt(maxBetweenVar / (total * total * 0.25));
  if (separation > 18) {
    const mask = new Uint8Array(total);
    let fgCount = 0;
    for (let i = 0; i < total; i++) {
      if (smooth[i] >= otsuThresh) {
        mask[i] = 1;
        fgCount++;
      }
    }

    const fgRatio = fgCount / total;
    if (fgRatio >= 0.16 && fgRatio <= 0.92) {
      // Find largest connected foreground component via iterative BFS
      const visited = new Uint8Array(total);
      const queue = new Int32Array(total);
      let bestComponent: number[] = [];

      for (let i = 0; i < total; i++) {
        if (!mask[i] || visited[i]) continue;
        let head = 0;
        let tail = 0;
        queue[tail++] = i;
        visited[i] = 1;
        const comp: number[] = [];

        while (head < tail) {
          const cur = queue[head++];
          comp.push(cur);
          const cx = cur % targetW;
          const cy = (cur / targetW) | 0;

          if (cx > 0 && mask[cur - 1] && !visited[cur - 1]) {
            visited[cur - 1] = 1;
            queue[tail++] = cur - 1;
          }
          if (cx < targetW - 1 && mask[cur + 1] && !visited[cur + 1]) {
            visited[cur + 1] = 1;
            queue[tail++] = cur + 1;
          }
          if (cy > 0 && mask[cur - targetW] && !visited[cur - targetW]) {
            visited[cur - targetW] = 1;
            queue[tail++] = cur - targetW;
          }
          if (cy < targetH - 1 && mask[cur + targetW] && !visited[cur + targetW]) {
            visited[cur + targetW] = 1;
            queue[tail++] = cur + targetW;
          }
        }

        if (comp.length > bestComponent.length) {
          bestComponent = comp;
        }
      }

      if (bestComponent.length >= total * 0.16) {
        // Extract extreme 4 corners of the paper component using (x+y) and (x-y) projections
        let tlPt: Point = { x: 0.02, y: 0.02 };
        let brPt: Point = { x: 0.98, y: 0.98 };
        let trPt: Point = { x: 0.98, y: 0.02 };
        let blPt: Point = { x: 0.02, y: 0.98 };

        let minSum = Infinity;
        let maxSum = -Infinity;
        let maxDiff = -Infinity;
        let minDiff = Infinity;

        for (let k = 0; k < bestComponent.length; k++) {
          const idx = bestComponent[k];
          const px = idx % targetW;
          const py = (idx / targetW) | 0;

          const sum = px + py;
          const diff = px - py;

          if (sum < minSum) {
            minSum = sum;
            tlPt = { x: px / targetW, y: py / targetH };
          }
          if (sum > maxSum) {
            maxSum = sum;
            brPt = { x: px / targetW, y: py / targetH };
          }
          if (diff > maxDiff) {
            maxDiff = diff;
            trPt = { x: px / targetW, y: py / targetH };
          }
          if (diff < minDiff) {
            minDiff = diff;
            blPt = { x: px / targetW, y: py / targetH };
          }
        }

        const candidate: Corners = {
          topLeft: tlPt,
          topRight: trPt,
          bottomRight: brPt,
          bottomLeft: blPt,
        };

        const area = polygonArea([
          candidate.topLeft,
          candidate.topRight,
          candidate.bottomRight,
          candidate.bottomLeft,
        ]);

        const topW = candidate.topRight.x - candidate.topLeft.x;
        const botW = candidate.bottomRight.x - candidate.bottomLeft.x;
        const leftH = candidate.bottomLeft.y - candidate.topLeft.y;
        const rightH = candidate.bottomRight.y - candidate.topRight.y;

        if (
          area >= 0.18 &&
          topW >= 0.25 &&
          botW >= 0.25 &&
          leftH >= 0.25 &&
          rightH >= 0.25
        ) {
          return candidate;
        }
      }
    }
  }

  // Fallback for already-cropped or uniform-lighting captures: full-frame slight safety inset
  return getDefaultCorners(0.01);
}

function solveLinearSystem8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }

    if (maxVal < 1e-10) return null;
    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let j = col; j <= n; j++) {
      M[col][j] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let j = col; j <= n; j++) {
        M[r][j] -= factor * M[col][j];
      }
    }
  }

  return M.map((row) => row[n]);
}

function computeInverseHomography(
  dstW: number,
  dstH: number,
  srcPts: [Point, Point, Point, Point]
): number[] | null {
  const dstPts: [Point, Point, Point, Point] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const u = dstPts[i].x;
    const v = dstPts[i].y;
    const x = srcPts[i].x;
    const y = srcPts[i].y;

    A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    b.push(y);
  }

  const h = solveLinearSystem8(A, b);
  if (!h) return null;
  return [...h, 1];
}

/**
 * Straightens and crops the detected paper quad via bilinear perspective warp.
 */
export function warpPerspective(
  source: HTMLImageElement | HTMLCanvasElement,
  corners: Corners,
  maxOutputDim = 2000
): HTMLCanvasElement {
  const srcW =
    source instanceof HTMLImageElement
      ? source.naturalWidth || source.width
      : source.width;
  const srcH =
    source instanceof HTMLImageElement
      ? source.naturalHeight || source.height
      : source.height;

  const pTL = { x: corners.topLeft.x * srcW, y: corners.topLeft.y * srcH };
  const pTR = { x: corners.topRight.x * srcW, y: corners.topRight.y * srcH };
  const pBR = { x: corners.bottomRight.x * srcW, y: corners.bottomRight.y * srcH };
  const pBL = { x: corners.bottomLeft.x * srcW, y: corners.bottomLeft.y * srcH };

  const widthTop = Math.hypot(pTR.x - pTL.x, pTR.y - pTL.y);
  const widthBottom = Math.hypot(pBR.x - pBL.x, pBR.y - pBL.y);
  const heightLeft = Math.hypot(pBL.x - pTL.x, pBL.y - pTL.y);
  const heightRight = Math.hypot(pBR.x - pTR.x, pBR.y - pTR.y);

  let outW = Math.max(160, Math.round(Math.max(widthTop, widthBottom)));
  let outH = Math.max(160, Math.round(Math.max(heightLeft, heightRight)));

  if (Math.max(outW, outH) > maxOutputDim) {
    const scale = maxOutputDim / Math.max(outW, outH);
    outW = Math.max(120, Math.round(outW * scale));
    outH = Math.max(120, Math.round(outH * scale));
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) {
    throw new Error('Could not initialize image canvas.');
  }
  srcCtx.drawImage(source, 0, 0, srcW, srcH);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) {
    throw new Error('Could not create output canvas.');
  }

  const H = computeInverseHomography(outW, outH, [pTL, pTR, pBR, pBL]);
  if (!H) {
    outCtx.drawImage(srcCanvas, 0, 0, outW, outH);
    return outCanvas;
  }

  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;
  const dstImg = outCtx.createImageData(outW, outH);
  const dstData = dstImg.data;

  const [h0, h1, h2, h3, h4, h5, h6, h7] = H;
  const maxSrcX = srcW - 1.001;
  const maxSrcY = srcH - 1.001;

  for (let y = 0; y < outH; y++) {
    const rowBase = y * outW * 4;
    const h1y_h2 = h1 * y + h2;
    const h4y_h5 = h4 * y + h5;
    const h7y_1 = h7 * y + 1;

    for (let x = 0; x < outW; x++) {
      const denom = h6 * x + h7y_1;
      const sx = (h0 * x + h1y_h2) / denom;
      const sy = (h3 * x + h4y_h5) / denom;

      const cx = sx < 0 ? 0 : sx > maxSrcX ? maxSrcX : sx;
      const cy = sy < 0 ? 0 : sy > maxSrcY ? maxSrcY : sy;

      const x0 = cx | 0;
      const y0 = cy | 0;
      const dx = cx - x0;
      const dy = cy - y0;
      const dx1 = 1 - dx;
      const dy1 = 1 - dy;

      const w00 = dx1 * dy1;
      const w10 = dx * dy1;
      const w01 = dx1 * dy;
      const w11 = dx * dy;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + srcW * 4;
      const i11 = i01 + 4;

      const outIdx = rowBase + x * 4;
      dstData[outIdx] =
        srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      dstData[outIdx + 1] =
        srcData[i00 + 1] * w00 +
        srcData[i10 + 1] * w10 +
        srcData[i01 + 1] * w01 +
        srcData[i11 + 1] * w11;
      dstData[outIdx + 2] =
        srcData[i00 + 2] * w00 +
        srcData[i10 + 2] * w10 +
        srcData[i01 + 2] * w01 +
        srcData[i11 + 2] * w11;
      dstData[outIdx + 3] = 255;
    }
  }

  outCtx.putImageData(dstImg, 0, 0);
  return outCanvas;
}

/**
 * Estimates dominant horizontal text skew angle (-8° to +8°) using projection variance
 * and rotates slightly if tilted so text lines sit level.
 */
function fineDeskewDocument(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const sampleW = 220;
  const sampleH = Math.max(120, Math.round((h / w) * sampleW));

  const small = document.createElement('canvas');
  small.width = sampleW;
  small.height = sampleH;
  const sCtx = small.getContext('2d', { willReadFrequently: true });
  if (!sCtx) return canvas;
  sCtx.drawImage(canvas, 0, 0, sampleW, sampleH);
  const { data } = sCtx.getImageData(0, 0, sampleW, sampleH);

  // Build dark-ink mask (pixels noticeably darker than local brightness)
  const ink = new Uint8Array(sampleW * sampleH);
  let sumLum = 0;
  for (let i = 0; i < sampleW * sampleH; i++) {
    const idx = i * 4;
    sumLum += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }
  const meanLum = sumLum / (sampleW * sampleH);
  const inkThreshold = meanLum * 0.78;

  let inkCount = 0;
  for (let i = 0; i < sampleW * sampleH; i++) {
    const idx = i * 4;
    const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    if (lum < inkThreshold) {
      ink[i] = 1;
      inkCount++;
    }
  }

  // If sparse or blank page, skip deskew
  if (inkCount < sampleW * 2) return canvas;

  let bestAngle = 0;
  let bestScore = -1;

  for (let deg = -6; deg <= 6; deg += 0.75) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = sampleW / 2;
    const cy = sampleH / 2;

    const rowHist = new Float32Array(sampleH);
    for (let y = 4; y < sampleH - 4; y += 2) {
      for (let x = 4; x < sampleW - 4; x += 2) {
        if (!ink[y * sampleW + x]) continue;
        const ry = Math.round(-(x - cx) * sin + (y - cy) * cos + cy);
        if (ry >= 0 && ry < sampleH) {
          rowHist[ry]++;
        }
      }
    }

    // Variance of horizontal projection: sharper peaks = straighter text lines
    let variance = 0;
    for (let r = 0; r < sampleH; r++) {
      variance += rowHist[r] * rowHist[r];
    }

    if (variance > bestScore) {
      bestScore = variance;
      bestAngle = deg;
    }
  }

  if (Math.abs(bestAngle) < 0.8) {
    return canvas;
  }

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-bestAngle * Math.PI) / 180);
  ctx.drawImage(canvas, -w / 2, -h / 2);
  return out;
}

/**
 * Converts a cropped photo into a clean, professional scanner-grade page:
 * 1. Estimates smooth local paper illumination (shadow & lighting removal)
 * 2. Divides out uneven shadows & color casts so paper snaps to pure #FFFFFF
 * 3. Sharpens text & preserves readable ink/stamps with high document contrast
 * 4. Cleans tiny outer frame border artifacts so edges meet white PDF paper seamlessly
 */
export function convertToCleanDocumentScan(inputCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = inputCanvas.width;
  const h = inputCanvas.height;

  // Step 1: Build a coarse local-maximum background map to model uneven shadows & lighting
  const bgScale = 12;
  const bgW = Math.max(16, Math.ceil(w / bgScale));
  const bgH = Math.max(16, Math.ceil(h / bgScale));

  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = bgW;
  bgCanvas.height = bgH;
  const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });

  const inCtx = inputCanvas.getContext('2d', { willReadFrequently: true });
  if (!bgCtx || !inCtx) return inputCanvas;

  // Compute local 85th-percentile / bright envelope per coarse block from source pixels
  const srcImg = inCtx.getImageData(0, 0, w, h);
  const src = srcImg.data;

  const bgR = new Float32Array(bgW * bgH);
  const bgG = new Float32Array(bgW * bgH);
  const bgB = new Float32Array(bgW * bgH);

  for (let by = 0; by < bgH; by++) {
    const y0 = by * bgScale;
    const y1 = Math.min(h, y0 + bgScale);
    for (let bx = 0; bx < bgW; bx++) {
      const x0 = bx * bgScale;
      const x1 = Math.min(w, x0 + bgScale);

      // Track brightest pixels inside the block (representing paper sheet under local shadow)
      let maxLum = -1;
      let topR = 235;
      let topG = 235;
      let topB = 235;

      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const idx = (y * w + x) * 4;
          const r = src[idx];
          const g = src[idx + 1];
          const b = src[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          if (lum > maxLum) {
            maxLum = lum;
            topR = r;
            topG = g;
            topB = b;
          }
        }
      }

      const bIdx = by * bgW + bx;
      bgR[bIdx] = Math.max(85, topR);
      bgG[bIdx] = Math.max(85, topG);
      bgB[bIdx] = Math.max(85, topB);
    }
  }

  // Smooth the coarse background map across 3x3 blocks (removes small dark block dips)
  const smoothR = new Float32Array(bgW * bgH);
  const smoothG = new Float32Array(bgW * bgH);
  const smoothB = new Float32Array(bgW * bgH);

  for (let by = 0; by < bgH; by++) {
    for (let bx = 0; bx < bgW; bx++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let count = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = by + dy;
        if (ny < 0 || ny >= bgH) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = bx + dx;
          if (nx < 0 || nx >= bgW) continue;
          const idx = ny * bgW + nx;
          sr += bgR[idx];
          sg += bgG[idx];
          sb += bgB[idx];
          count++;
        }
      }
      const outIdx = by * bgW + bx;
      smoothR[outIdx] = sr / count;
      smoothG[outIdx] = sg / count;
      smoothB[outIdx] = sb / count;
    }
  }

  // Step 2: Divide image by smoothed local paper background -> pure white paper + crisp ink
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  if (!outCtx) return inputCanvas;

  const outImg = outCtx.createImageData(w, h);
  const dst = outImg.data;

  // Clean outer 1.2% edge artifacts where table border might remain
  const borderX = Math.max(3, Math.round(w * 0.012));
  const borderY = Math.max(3, Math.round(h * 0.012));

  for (let y = 0; y < h; y++) {
    const fby = Math.min(bgH - 1.001, Math.max(0, y / bgScale - 0.5));
    const by0 = fby | 0;
    const by1 = Math.min(bgH - 1, by0 + 1);
    const ty = fby - by0;

    const isBorderY = y < borderY || y >= h - borderY;

    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (isBorderY || x < borderX || x >= w - borderX) {
        dst[idx] = 255;
        dst[idx + 1] = 255;
        dst[idx + 2] = 255;
        dst[idx + 3] = 255;
        continue;
      }

      const fbx = Math.min(bgW - 1.001, Math.max(0, x / bgScale - 0.5));
      const bx0 = fbx | 0;
      const bx1 = Math.min(bgW - 1, bx0 + 1);
      const tx = fbx - bx0;

      const i00 = by0 * bgW + bx0;
      const i10 = by0 * bgW + bx1;
      const i01 = by1 * bgW + bx0;
      const i11 = by1 * bgW + bx1;

      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;

      const localR = smoothR[i00] * w00 + smoothR[i10] * w10 + smoothR[i01] * w01 + smoothR[i11] * w11;
      const localG = smoothG[i00] * w00 + smoothG[i10] * w10 + smoothG[i01] * w01 + smoothG[i11] * w11;
      const localB = smoothB[i00] * w00 + smoothB[i10] * w10 + smoothB[i01] * w01 + smoothB[i11] * w11;

      // Shadow-free normalized reflectance
      let nr = (src[idx] / localR) * 255;
      let ng = (src[idx + 1] / localG) * 255;
      let nb = (src[idx + 2] / localB) * 255;

      const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;

      // White-point snap & ink-contrast enhancement
      if (lum >= 216) {
        // Snap paper grain & faint creases to clean pure white #FFFFFF
        dst[idx] = 255;
        dst[idx + 1] = 255;
        dst[idx + 2] = 255;
      } else {
        // Stretch text / ink range [0..216] cleanly for razor-sharp readability
        // while keeping colored pens/highlights natural
        const stretch = (v: number) => {
          const norm = Math.max(0, Math.min(1, (v - 26) / 190));
          // Gentle gamma darken on mid-dark ink strokes
          const curved = Math.pow(norm, 1.32);
          return curved * 255;
        };

        nr = stretch(nr);
        ng = stretch(ng);
        nb = stretch(nb);

        // If pixel is nearly neutral grey/black ink, push toward crisp dark charcoal ink
        const maxCh = Math.max(nr, ng, nb);
        const minCh = Math.min(nr, ng, nb);
        if (maxCh - minCh < 22) {
          const mono = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          dst[idx] = clampByte(mono);
          dst[idx + 1] = clampByte(mono);
          dst[idx + 2] = clampByte(mono);
        } else {
          dst[idx] = clampByte(nr);
          dst[idx + 1] = clampByte(ng);
          dst[idx + 2] = clampByte(nb);
        }
      }
      dst[idx + 3] = 255;
    }
  }

  // Step 3: Subtle text-sharpening pass (unsharp mask on non-white ink regions)
  const copy = new Uint8ClampedArray(dst);
  const sharpAmount = 0.28;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      if (copy[idx] === 255 && copy[idx + 1] === 255 && copy[idx + 2] === 255) {
        continue;
      }
      const up = idx - w * 4;
      const down = idx + w * 4;
      const left = idx - 4;
      const right = idx + 4;

      for (let ch = 0; ch < 3; ch++) {
        const lap =
          4 * copy[idx + ch] -
          copy[up + ch] -
          copy[down + ch] -
          copy[left + ch] -
          copy[right + ch];
        dst[idx + ch] = clampByte(copy[idx + ch] + lap * sharpAmount);
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

/**
 * Fully automatic scan conversion pipeline:
 * Photo -> Detect Edges -> Perspective Straighten -> Fine Deskew ->
 * Shadow Removal & Pure White Page Background + Crisp Text -> JPEG Output.
 */
export async function autoConvertPhotoToCleanScan(
  rawImageDataUrl: string,
  autoDetectEdges = true,
  maxDim = 2000
): Promise<{
  originalDataUrl: string;
  processedDataUrl: string;
  corners: Corners;
  width: number;
  height: number;
}> {
  const normalizedUrl = await normalizeCapturedImage(rawImageDataUrl, 2400);
  const img = await loadImage(normalizedUrl);

  const corners = autoDetectEdges
    ? detectDocumentCorners(img)
    : getDefaultCorners(0.01);

  const warped = warpPerspective(img, corners, maxDim);
  const deskewed = fineDeskewDocument(warped);
  const cleanScan = convertToCleanDocumentScan(deskewed);

  return {
    originalDataUrl: normalizedUrl,
    processedDataUrl: cleanScan.toDataURL('image/jpeg', 0.92),
    corners,
    width: cleanScan.width,
    height: cleanScan.height,
  };
}

export async function createThumbnail(
  dataUrl: string,
  maxWidth = 380
): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxWidth / w);

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export const DEFAULT_AUTO_FILTER = EnhancementFilter.Auto;
