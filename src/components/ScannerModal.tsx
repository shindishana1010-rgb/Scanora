import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  ImagePlus,
  Layers,
  RefreshCw,
  X,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { Corners } from '../types/paperscan';
import {
  detectDocumentCorners,
  normalizeCapturedImage,
  readFileAsDataUrl,
} from '../utils/imageProcessing';

interface ScannerModalProps {
  isOpen: boolean;
  autoDetectEdges: boolean;
  onClose: () => void;
  onCaptureComplete: (imageDataUrls: string[]) => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  autoDetectEdges,
  onClose,
  onCaptureComplete,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraState, setCameraState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [liveCorners, setLiveCorners] = useState<Corners | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Camera capture mode: Single Page (instant save) or Multi-Page (combine multiple pages into one PDF)
  const [multiPageMode, setMultiPageMode] = useState(false);
  const [capturedPages, setCapturedPages] = useState<string[]>([]);
  const [flashPulse, setFlashPulse] = useState(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchEnabled(false);
    setTorchSupported(false);
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopCamera();
      setCameraState('loading');
      setErrorMessage('');
      setLiveCorners(null);

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setCameraState('error');
        setErrorMessage(
          'Camera access is not supported in this browser or context. You can upload photos from your device instead.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          const caps = videoTrack.getCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
          };
          setTorchSupported(Boolean(caps.torch));
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState('ready');
      } catch (err) {
        setCameraState('error');
        if (err instanceof DOMException) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setErrorMessage(
              'Camera permission was denied. Allow camera access in your browser settings, or upload photos below.'
            );
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setErrorMessage(
              'No camera was detected on this device. You can upload document photos from your files.'
            );
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            setErrorMessage(
              'Your camera is currently being used by another app. Close other camera apps and retry, or upload photos.'
            );
          } else {
            setErrorMessage(
              `Could not start camera (${err.message || err.name}). You can upload photos instead.`
            );
          }
        } else {
          setErrorMessage(
            'Unable to access camera on this device. You can upload photos instead.'
          );
        }
      }
    },
    [stopCamera]
  );

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCapturedPages([]);
      setMultiPageMode(false);
      return;
    }
    startCamera(facingMode);
    return () => stopCamera();
  }, [isOpen, facingMode, startCamera, stopCamera]);

  useEffect(() => {
    if (!isOpen || cameraState !== 'ready' || !autoDetectEdges) {
      setLiveCorners(null);
      return;
    }

    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          setLiveCorners(detectDocumentCorners(video));
        } catch {
          // Ignore transient frame errors
        }
      }
    }, 420);

    return () => window.clearInterval(timer);
  }, [isOpen, cameraState, autoDetectEdges]);

  const handleToggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchEnabled(next);
    } catch {
      // Ignore if device refuses torch constraint
    }
  };

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || cameraState !== 'ready' || isCapturing) return;

    setIsCapturing(true);
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        throw new Error('Camera feed is not ready yet.');
      }

      const canvas = document.createElement('canvas');
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to capture camera frame.');
      }
      ctx.drawImage(video, 0, 0, vw, vh);

      const rawUrl = canvas.toDataURL('image/jpeg', 0.94);
      const normalized = await normalizeCapturedImage(rawUrl);

      if (multiPageMode) {
        setFlashPulse(true);
        setTimeout(() => setFlashPulse(false), 180);
        setCapturedPages((prev) => [...prev, normalized]);
      } else {
        stopCamera();
        onCaptureComplete([normalized]);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to capture photo. Please try again.'
      );
      setCameraState('error');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleFinishMultiPage = () => {
    if (capturedPages.length === 0) return;
    const batch = [...capturedPages];
    stopCamera();
    onCaptureComplete(batch);
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsCapturing(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const raw = await readFileAsDataUrl(files[i]);
        const normalized = await normalizeCapturedImage(raw);
        urls.push(normalized);
      }

      if (multiPageMode && capturedPages.length > 0) {
        setCapturedPages((prev) => [...prev, ...urls]);
      } else {
        stopCamera();
        onCaptureComplete(urls);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not load the selected image file.'
      );
    } finally {
      setIsCapturing(false);
      e.target.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0F243E] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Document Scanner"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[#0F243E]/90 backdrop-blur-md border-b border-white/10">
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-white/90 hover:bg-white/10 transition-colors focus-visible:outline-2 focus-visible:outline-white"
          aria-label="Close scanner"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Single Page vs Multi-Page Switcher */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/10">
          <button
            type="button"
            onClick={() => {
              if (capturedPages.length === 0) setMultiPageMode(false);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              !multiPageMode
                ? 'bg-white text-[#173B65]'
                : 'text-white/85 hover:text-white'
            }`}
          >
            Single Page
          </button>
          <button
            type="button"
            onClick={() => setMultiPageMode(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap ${
              multiPageMode
                ? 'bg-white text-[#173B65]'
                : 'text-white/85 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Multi-Page</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {torchSupported && (
            <button
              type="button"
              onClick={handleToggleTorch}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors ${
                torchEnabled
                  ? 'bg-[#EAF3FC] text-[#173B65]'
                  : 'text-white/90 hover:bg-white/10'
              }`}
              aria-label={torchEnabled ? 'Turn off flash' : 'Turn on flash'}
            >
              <Zap className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
            }
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-white/90 hover:bg-white/10 transition-colors"
            aria-label="Switch camera"
            title="Switch camera"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Camera Viewfinder / Fallback */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-contain ${
            cameraState === 'ready' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {flashPulse && (
          <div className="pointer-events-none absolute inset-0 bg-white/55 transition-opacity" />
        )}

        {cameraState === 'ready' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="w-full h-full"
            >
              {liveCorners && (
                <polygon
                  points={`${liveCorners.topLeft.x * 100},${liveCorners.topLeft.y * 100} ${
                    liveCorners.topRight.x * 100
                  },${liveCorners.topRight.y * 100} ${
                    liveCorners.bottomRight.x * 100
                  },${liveCorners.bottomRight.y * 100} ${
                    liveCorners.bottomLeft.x * 100
                  },${liveCorners.bottomLeft.y * 100}`}
                  fill="rgba(234, 243, 252, 0.14)"
                  stroke="#6AA8E8"
                  strokeWidth="0.7"
                  strokeLinejoin="round"
                  className="transition-all duration-300"
                />
              )}
            </svg>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-black/55 backdrop-blur-sm text-xs text-white/90 whitespace-nowrap">
              {multiPageMode
                ? capturedPages.length === 0
                  ? 'Capture page 1 — tap Create PDF when finished'
                  : `${capturedPages.length} ${
                      capturedPages.length === 1 ? 'page' : 'pages'
                    } ready — capture next or tap Save PDF`
                : 'Tap shutter — straightens, cleans & saves PDF automatically'}
            </div>
          </div>
        )}

        {cameraState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#173B65] flex items-center justify-center mb-4">
              <Camera className="w-6 h-6 text-[#EAF3FC] animate-pulse" />
            </div>
            <p className="font-display text-base font-semibold text-white">
              Starting camera...
            </p>
            <p className="text-sm text-[#B9D2EC] mt-1 max-w-xs">
              Please approve camera access if your browser asks for permission.
            </p>
          </div>
        )}

        {cameraState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center bg-[#0F243E]">
            <div className="max-w-md w-full bg-white text-[#252525] rounded-2xl p-6 shadow-xl">
              <div className="w-12 h-12 rounded-xl bg-[#EAF3FC] text-[#173B65] flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="font-display text-lg font-bold text-[#173B65]">
                Camera Unavailable
              </h3>
              <p className="text-sm text-[#505A66] mt-2 leading-relaxed">
                {errorMessage}
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-[#173B65] text-white text-sm font-semibold hover:bg-[#1E4C82] transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                >
                  <ImagePlus className="w-4 h-4" />
                  Upload Photos
                </button>
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl bg-[#EAF3FC] text-[#173B65] text-sm font-semibold hover:bg-[#DCEBFA] transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retry Camera
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Shutter Controls */}
      <div className="px-5 py-4 pb-safe bg-[#0F243E] border-t border-white/10">
        <div className="max-w-xl mx-auto flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isCapturing}
            className="min-h-[48px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs sm:text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <ImagePlus className="w-5 h-5 text-[#EAF3FC]" />
            <span>Import</span>
          </button>

          <button
            type="button"
            onClick={handleCapture}
            disabled={cameraState !== 'ready' || isCapturing}
            aria-label={
              multiPageMode
                ? 'Capture page'
                : 'Capture and convert to PDF automatically'
            }
            className="relative w-[70px] h-[70px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
          >
            <span className="w-[54px] h-[54px] rounded-full bg-white flex items-center justify-center">
              <Camera className="w-6 h-6 text-[#173B65]" />
            </span>
          </button>

          {multiPageMode && capturedPages.length > 0 ? (
            <button
              type="button"
              onClick={handleFinishMultiPage}
              className="min-h-[48px] px-3.5 py-2 rounded-xl bg-[#EAF3FC] text-[#173B65] hover:bg-white text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 tabular-nums"
            >
              <Check className="w-4 h-4" />
              <span>Save PDF ({capturedPages.length})</span>
            </button>
          ) : (
            <div className="min-w-[96px]" aria-hidden="true" />
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />
    </div>
  );
};
