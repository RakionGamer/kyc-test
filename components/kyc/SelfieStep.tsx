'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Eye, Camera, RefreshCw, Check, ArrowRight, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'
import clsx from 'clsx'

type LivenessCheck = {
  id: string
  label: string
  done: boolean
}

const initialChecks: LivenessCheck[] = [
  { id: 'center', label: 'Centra tu rostro en el óvalo', done: false },
  { id: 'look', label: 'Mira directamente a la cámara', done: false },
  { id: 'blink', label: 'Parpadea naturalmente', done: false },
  { id: 'smile', label: 'Sonríe levemente', done: false },
]

type Mode = 'guide' | 'camera' | 'preview' | 'analyzing'

export default function SelfieStep() {
  const { setStep, setSelfie, completeStep } = useKYCStore()
  const [mode, setMode] = useState<Mode>('guide')
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [checks, setChecks] = useState<LivenessCheck[]>(initialChecks)
  const [currentCheckIndex, setCurrentCheckIndex] = useState(0)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [faceDetected, setFaceDetected] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const checkTimerRef = useRef<NodeJS.Timeout | null>(null)
  const faceDetectTimerRef = useRef<NodeJS.Timeout | null>(null)

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (checkTimerRef.current) clearInterval(checkTimerRef.current)
    if (faceDetectTimerRef.current) clearTimeout(faceDetectTimerRef.current)
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setChecks(initialChecks)
    setCurrentCheckIndex(0)
    setFaceDetected(false)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      setMode('camera')

      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      // Simulate face detection after 1.5s
      faceDetectTimerRef.current = setTimeout(() => {
        setFaceDetected(true)
        // Start liveness checks
        let checkIdx = 0
        checkTimerRef.current = setInterval(() => {
          if (checkIdx < initialChecks.length) {
            setChecks(prev => prev.map((c, i) => i === checkIdx ? { ...c, done: true } : c))
            setCurrentCheckIndex(checkIdx + 1)
            checkIdx++
          } else {
            clearInterval(checkTimerRef.current!)
            // Auto capture
            setCountdown(3)
          }
        }, 1200)
      }, 1500)

    } catch (err) {
      setCameraError('No se pudo acceder a la cámara frontal. Verifica los permisos del navegador.')
    }
  }, [])

  // Countdown effect
  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      capturePhoto()
      return
    }
    const t = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Mirror the image (selfie)
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    const image = canvas.toDataURL('image/jpeg', 0.9)
    stopCamera()
    setCapturedImage(image)
    setCountdown(null)
    setMode('preview')
  }, [stopCamera])

  const retake = () => {
    setCapturedImage(null)
    setMode('guide')
  }

  const analyzeAndConfirm = async () => {
    setMode('analyzing')
    setAnalysisProgress(0)
    // Simulate AI analysis
    const steps = [15, 35, 55, 72, 88, 95, 100]
    for (const progress of steps) {
      await new Promise(r => setTimeout(r, 400))
      setAnalysisProgress(progress)
    }
    const score = Math.floor(Math.random() * 15) + 85 // 85-100
    if (capturedImage) {
      setSelfie(capturedImage, score)
      completeStep('selfie')
      setStep('review')
    }
  }

  return (
    <div className="fade-in-up max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
          <Eye size={18} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Syne, sans-serif' }}>
            Verificación Facial
          </h2>
          <p className="text-xs text-zinc-500">Prueba de vida en tiempo real</p>
        </div>
      </div>

      {cameraError && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <AlertCircle size={16} className="text-red-400 mt-0.5" />
          <p className="text-sm text-red-300">{cameraError}</p>
        </div>
      )}

      {/* Guide */}
      {mode === 'guide' && (
        <div className="space-y-5">
          {/* Oval guide illustration */}
          <div className="relative bg-[#0f0f14] border border-white/8 rounded-2xl overflow-hidden aspect-[4/3] flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-radial from-amber-500/5 to-transparent" />
            {/* Oval */}
            <div className="relative w-44 h-56 border-2 border-amber-500/50 rounded-full oval-pulse flex items-center justify-center">
              <div className="text-6xl select-none">👤</div>
              {/* Corner indicators */}
              <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-amber-400" />
              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-amber-400" />
              <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-amber-400" />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-amber-400" />
            </div>
          </div>

          {/* Instructions */}
          <div className="grid grid-cols-2 gap-2">
            {[
              '✅ Buena iluminación frontal',
              '✅ Fondo claro y neutro',
              '❌ Sin lentes de sol',
              '❌ Sin cubrir el rostro',
            ].map((tip, i) => (
              <div key={i} className={clsx(
                'text-xs px-3 py-2 rounded-lg',
                tip.startsWith('✅') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              )}>
                {tip}
              </div>
            ))}
          </div>

          <button
            onClick={startCamera}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 transition-all duration-200"
            style={{ fontFamily: 'Syne, sans-serif' }}
          >
            <Camera size={18} />
            Iniciar verificación facial
          </button>
        </div>
      )}

      {/* Camera mode */}
      {mode === 'camera' && (
        <div className="space-y-4">
          {/* Video with oval overlay */}
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]"
              onLoadedMetadata={e => (e.target as HTMLVideoElement).play()}
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Oval overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {/* Dark mask */}
              <div
                className="absolute inset-0"
                style={{
                  background: 'radial-gradient(ellipse 50% 65% at 50% 48%, transparent 100%, rgba(0,0,0,0.6) 100%)',
                }}
              />
              {/* Oval border */}
              <div className={clsx(
                'relative border-2 rounded-full transition-all duration-500',
                faceDetected ? 'border-green-400 w-52 h-64' : 'border-amber-400/70 w-52 h-64'
              )}>
                {/* Scan line when face detected */}
                {faceDetected && (
                  <div className="absolute inset-0 overflow-hidden rounded-full">
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-green-400 to-transparent scan-line" />
                  </div>
                )}
              </div>
            </div>

            {/* Face detected badge */}
            {faceDetected && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-green-500/20 border border-green-500/30 backdrop-blur-sm px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400 font-medium">Rostro detectado</span>
              </div>
            )}

            {/* Countdown overlay */}
            {countdown !== null && countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center border-2 border-amber-500">
                  <span className="text-4xl font-bold text-amber-400" style={{ fontFamily: 'Syne, sans-serif' }}>
                    {countdown}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Liveness checks */}
          <div className="bg-white/3 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-3 font-medium">Verificación de vida en progreso...</p>
            <div className="space-y-2">
              {checks.map((check, i) => (
                <div key={check.id} className={clsx(
                  'flex items-center gap-3 text-xs transition-all duration-300',
                  check.done ? 'text-green-400' : i === currentCheckIndex ? 'text-amber-400' : 'text-zinc-600'
                )}>
                  {check.done ? (
                    <CheckCircle2 size={14} />
                  ) : i === currentCheckIndex ? (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border border-zinc-700" />
                  )}
                  {check.label}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => { stopCamera(); setMode('guide') }}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Preview */}
      {mode === 'preview' && capturedImage && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-[4/3]">
            <img src={capturedImage} alt="Selfie" className="w-full h-full object-cover" />
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-green-400 font-medium">Foto capturada</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 text-center">
            ¿Tu rostro es claramente visible y bien iluminado?
          </p>
          <div className="flex gap-3">
            <button onClick={retake} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-300 text-sm">
              <RefreshCw size={14} /> Repetir
            </button>
            <button
              onClick={analyzeAndConfirm}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] transition-all"
              style={{ fontFamily: 'Syne, sans-serif' }}
            >
              <Check size={16} /> Analizar
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Analyzing */}
      {mode === 'analyzing' && (
        <div className="text-center py-8 space-y-6">
          <div className="relative w-32 h-32 mx-auto">
            {capturedImage && (
              <img src={capturedImage} alt="Analyzing" className="w-full h-full object-cover rounded-full border-2 border-amber-500/40" />
            )}
            {/* Circular progress */}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r="60" fill="none" stroke="#27272a" strokeWidth="4" />
              <circle
                cx="64" cy="64" r="60" fill="none" stroke="#f59e0b" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 60}`}
                strokeDashoffset={`${2 * Math.PI * 60 * (1 - analysisProgress / 100)}`}
                style={{ transition: 'stroke-dashoffset 0.4s ease' }}
              />
            </svg>
          </div>

          <div>
            <p className="text-lg font-bold text-white mb-1" style={{ fontFamily: 'Syne, sans-serif' }}>
              Analizando biometría...
            </p>
            <p className="text-sm text-zinc-500">{analysisProgress}% completado</p>
          </div>

          <div className="space-y-2 text-left max-w-xs mx-auto">
            {[
              { label: 'Detección de rostro', done: analysisProgress > 20 },
              { label: 'Verificación de vida', done: analysisProgress > 50 },
              { label: 'Análisis de coincidencia', done: analysisProgress > 75 },
              { label: 'Validación final', done: analysisProgress >= 100 },
            ].map(item => (
              <div key={item.label} className={clsx(
                'flex items-center gap-3 text-xs',
                item.done ? 'text-green-400' : 'text-zinc-600'
              )}>
                {item.done ? <CheckCircle2 size={14} /> : <div className="w-3.5 h-3.5 rounded-full border border-zinc-700" />}
                {item.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
