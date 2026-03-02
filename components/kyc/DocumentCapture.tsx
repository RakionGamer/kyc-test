'use client'

import { useRef, useState, useCallback } from 'react'
import { Camera, Upload, RefreshCw, Check, ArrowRight, AlertCircle, RotateCcw } from 'lucide-react'
import clsx from 'clsx'

interface DocumentCaptureProps {
  title: string
  subtitle: string
  side: 'front' | 'back'
  onCapture: (image: string) => void
  guideLabel?: string
}

type CaptureMode = 'choose' | 'camera' | 'preview'

export default function DocumentCapture({ title, subtitle, side, onCapture, guideLabel }: DocumentCaptureProps) {
  const [mode, setMode] = useState<CaptureMode>('choose')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setMode('camera')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      setCameraError('No se pudo acceder a la cámara. Por favor, permite el acceso o carga una imagen.')
      setMode('choose')
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const image = canvas.toDataURL('image/jpeg', 0.92)
    stopCamera()
    setCapturedImage(image)
    setMode('preview')
  }, [stopCamera])

  const retake = () => {
    setCapturedImage(null)
    setMode('choose')
  }

  const confirmCapture = () => {
    if (capturedImage) {
      onCapture(capturedImage)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      setCapturedImage(reader.result as string)
      setMode('preview')
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="fade-in-up max-w-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1" style={{ fontFamily: 'Syne, sans-serif' }}>{title}</h2>
        <p className="text-sm text-zinc-500">{subtitle}</p>
      </div>

      {/* Camera error */}
      {cameraError && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-300">{cameraError}</p>
        </div>
      )}

      {/* Choose mode */}
      {mode === 'choose' && (
        <div className="space-y-3">
          {/* Document guide illustration */}
          <div className="bg-white/3 border border-white/8 rounded-2xl p-6 mb-4 aspect-video flex items-center justify-center relative overflow-hidden">
            {/* Animated guide frame */}
            <div className="relative w-full max-w-xs aspect-[1.586/1] border-2 border-dashed border-amber-500/40 rounded-lg flex items-center justify-center">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-amber-500 rounded-tl" />
              <div className="absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-amber-500 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-amber-500 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-amber-500 rounded-br" />
              <p className="text-zinc-600 text-xs text-center px-6">
                {guideLabel || `Coloca el ${side === 'front' ? 'frente' : 'reverso'} de tu documento aquí`}
              </p>
            </div>
          </div>

          <button
            onClick={startCamera}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 transition-all duration-200"
            style={{ fontFamily: 'Syne, sans-serif' }}
          >
            <Camera size={18} />
            Tomar foto con cámara
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-white/5 border border-white/8 text-zinc-300 font-medium text-sm hover:bg-white/8 hover:border-white/15 transition-all duration-200"
          >
            <Upload size={16} />
            Subir desde el dispositivo
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
        </div>
      )}

      {/* Camera mode */}
      {mode === 'camera' && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {/* Overlay frame */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative w-4/5 aspect-[1.586/1]">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-3 border-l-3 border-amber-400 rounded-tl-lg" style={{ borderWidth: 3 }} />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-3 border-r-3 border-amber-400 rounded-tr-lg" style={{ borderWidth: 3 }} />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-3 border-l-3 border-amber-400 rounded-bl-lg" style={{ borderWidth: 3 }} />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-3 border-r-3 border-amber-400 rounded-br-lg" style={{ borderWidth: 3 }} />
                {/* Scan line */}
                <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400 to-transparent scan-line" />
              </div>
            </div>
            {/* Bottom label */}
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <span className="text-xs text-white/70 bg-black/50 px-3 py-1 rounded-full">
                Encuadra el documento en el marco
              </span>
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex gap-3">
            <button
              onClick={() => { stopCamera(); setMode('choose') }}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all"
            >
              <RotateCcw size={14} /> Cancelar
            </button>
            <button
              onClick={capturePhoto}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-amber-500 text-black font-bold text-sm hover:bg-amber-400 transition-all"
              style={{ fontFamily: 'Syne, sans-serif' }}
            >
              <Camera size={16} /> Capturar
            </button>
          </div>
        </div>
      )}

      {/* Preview mode */}
      {mode === 'preview' && capturedImage && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/10">
            <img src={capturedImage} alt="Captured document" className="w-full object-cover" />
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-green-400 font-medium">Capturado</span>
            </div>
          </div>

          <p className="text-xs text-zinc-500 text-center">
            ¿La imagen es clara y todos los datos son legibles?
          </p>

          <div className="flex gap-3">
            <button
              onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-300 text-sm hover:bg-white/8 transition-all"
            >
              <RefreshCw size={14} /> Repetir
            </button>
            <button
              onClick={confirmCapture}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 transition-all duration-200"
              style={{ fontFamily: 'Syne, sans-serif' }}
            >
              <Check size={16} /> Confirmar
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
