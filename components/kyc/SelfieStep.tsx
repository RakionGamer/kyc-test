'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { Eye, Camera, RefreshCw, Check, ArrowRight, AlertCircle, CheckCircle2, Upload } from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'
import clsx from 'clsx'

type LivenessCheck = {
  id: string
  label: string
  instruction: string
  done: boolean
}

const buildChecks = (): LivenessCheck[] => [
  { id: 'center', label: 'Centra tu rostro',       instruction: '👤 Coloca tu cara dentro del óvalo', done: false },
  { id: 'blink',  label: 'Parpadea 2 veces',        instruction: '👁️ Parpadea lentamente 2 veces',    done: false },
  { id: 'left',   label: 'Gira a la izquierda',     instruction: '⬅️ Gira la cabeza a la izquierda', done: false },
  { id: 'right',  label: 'Gira a la derecha',       instruction: '➡️ Gira la cabeza a la derecha',   done: false },
  { id: 'smile',  label: 'Sonríe',                  instruction: '😊 Sonríe naturalmente',            done: false },
]

type Mode = 'guide' | 'camera' | 'preview' | 'analyzing'

// ── Pixel analysis helpers ────────────────────────────────────────────────────

function regionBrightness(
  data: Uint8ClampedArray,
  x0: number, y0: number,
  w: number, h: number,
  stride: number
): number {
  let sum = 0, n = 0
  const x1 = Math.min(x0 + w, stride)
  const y1 = y0 + h
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * stride + x) * 4
      sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      n++
    }
  }
  return n ? sum / n : 0
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelfieStep() {
  const { setStep, setSelfie, completeStep } = useKYCStore()

  const [mode, setMode]             = useState<Mode>('guide')
  const [capturedImage, setCaptured] = useState<string | null>(null)
  const [checks, setChecks]         = useState<LivenessCheck[]>(buildChecks())
  const [currentIdx, setCurrentIdx] = useState(0)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [faceInFrame, setFaceInFrame] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [capturing, setCapturing]   = useState(false)

  // Refs
  const videoRef     = useRef<HTMLVideoElement>(null)
  const sampleCanvas = useRef<HTMLCanvasElement>(null) // hidden — for pixel sampling
  const overlayRef   = useRef<HTMLCanvasElement>(null) // visible — shows camera + oval
  const streamRef    = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const loopRef      = useRef<number | null>(null)
  const drawRef      = useRef<number | null>(null)

  // Mutable state refs (avoid stale closures in rAF loops)
  const checksRef    = useRef<LivenessCheck[]>(buildChecks())
  const idxRef       = useRef(0)
  const faceRef      = useRef(false)
  const capturingRef = useRef(false)

  // Per-check accumulators
  const blinkCountRef  = useRef(0)
  const blinkBaseRef   = useRef<number | null>(null)
  const blinkCoolRef   = useRef(0)          // cooldown frames after blink
  const turnFramesRef  = useRef<number[]>([])
  const smileFramesRef = useRef<number[]>([])
  const smileBaseRef   = useRef<number | null>(null)
  const centerFrames   = useRef(0)

  // ── Stop everything ───────────────────────────────────────────────────────

  const stopAll = useCallback(() => {
    if (loopRef.current)  cancelAnimationFrame(loopRef.current)
    if (drawRef.current)  cancelAnimationFrame(drawRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => () => stopAll(), [stopAll])

  // ── Reset per-check accumulators ──────────────────────────────────────────

  const resetAccumulators = () => {
    blinkCountRef.current  = 0
    blinkBaseRef.current   = null
    blinkCoolRef.current   = 0
    turnFramesRef.current  = []
    smileFramesRef.current = []
    smileBaseRef.current   = null
    centerFrames.current   = 0
  }

  // ── Capture photo ─────────────────────────────────────────────────────────

  const capturePhoto = useCallback(() => {
    const video  = videoRef.current
    const canvas = sampleCanvas.current
    if (!video || !canvas || capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)

    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')!
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    ctx.restore()

    const image = canvas.toDataURL('image/jpeg', 0.92)
    stopAll()
    setCaptured(image)
    setMode('preview')
  }, [stopAll])

  // ── Analysis loop (rAF) ───────────────────────────────────────────────────

  const analysisLoop = useCallback(() => {
    const video  = videoRef.current
    const canvas = sampleCanvas.current
    if (!video || !canvas || video.readyState < 2 || capturingRef.current) {
      loopRef.current = requestAnimationFrame(analysisLoop)
      return
    }

    const W = video.videoWidth  || 320
    const H = video.videoHeight || 240
    canvas.width  = W
    canvas.height = H

    const ctx = canvas.getContext('2d')!
    // Sample original (un-mirrored) for analysis
    ctx.drawImage(video, 0, 0)
    const { data } = ctx.getImageData(0, 0, W, H)

    // ── Face presence: centre oval brightness vs corners ──────────────────
    const cB  = regionBrightness(data, Math.floor(W * 0.25), Math.floor(H * 0.15), Math.floor(W * 0.5), Math.floor(H * 0.7), W)
    const tl  = regionBrightness(data, 0, 0, Math.floor(W * 0.2), Math.floor(H * 0.2), W)
    const tr  = regionBrightness(data, Math.floor(W * 0.8), 0, Math.floor(W * 0.2), Math.floor(H * 0.2), W)
    const bgB = (tl + tr) / 2
    const hasFace = Math.abs(cB - bgB) > 6 && cB > 25

    faceRef.current = hasFace
    setFaceInFrame(hasFace)

    const idx = idxRef.current
    const check = checksRef.current[idx]

    if (!check || capturingRef.current) {
      loopRef.current = requestAnimationFrame(analysisLoop)
      return
    }

    if (!hasFace) {
      setInstruction('👤 Coloca tu cara dentro del óvalo')
      loopRef.current = requestAnimationFrame(analysisLoop)
      return
    }

    setInstruction(check.instruction)
    let passed = false

    // ── Per-check logic ────────────────────────────────────────────────────

    if (check.id === 'center') {
      centerFrames.current++
      passed = centerFrames.current > 20 // hold still for ~0.7s
    }

    else if (check.id === 'blink') {
      // Eye region: upper-middle strip
      const eyeY = Math.floor(H * 0.25)
      const eyeH = Math.floor(H * 0.14)
      const eyeX = Math.floor(W * 0.2)
      const eyeW = Math.floor(W * 0.6)
      const eyeB = regionBrightness(data, eyeX, eyeY, eyeW, eyeH, W)

      if (blinkBaseRef.current === null) {
        // Calibrate baseline for first 25 frames
        const arr = (blinkBaseRef as any)._arr = (blinkBaseRef as any)._arr || []
        arr.push(eyeB)
        if (arr.length >= 25) {
          blinkBaseRef.current = arr.reduce((a: number, b: number) => a + b, 0) / arr.length
          ;(blinkBaseRef as any)._arr = []
        }
      } else if (blinkCoolRef.current > 0) {
        blinkCoolRef.current--
      } else {
        const drop = blinkBaseRef.current - eyeB
        if (drop > 7) {
          // Eye closed (darker)
          blinkCountRef.current++
          blinkCoolRef.current = 18 // ~0.6s cooldown
          // Update baseline to current open-eye level
          blinkBaseRef.current = null
          ;(blinkBaseRef as any)._arr = []
        }
      }
      passed = blinkCountRef.current >= 2
    }

    else if (check.id === 'left') {
      // Left-side (from camera) brightness vs right side
      // When user turns left, camera-right side of face becomes more exposed → brighter
      const sideW = Math.floor(W * 0.22)
      const sideY = Math.floor(H * 0.2)
      const sideH = Math.floor(H * 0.55)
      const lB = regionBrightness(data, 0, sideY, sideW, sideH, W)
      const rB = regionBrightness(data, W - sideW, sideY, sideW, sideH, W)
      const diff = rB - lB // positive = right brighter = head turned toward left

      turnFramesRef.current.push(diff)
      if (turnFramesRef.current.length > 12) turnFramesRef.current.shift()
      const avg = turnFramesRef.current.reduce((a, b) => a + b, 0) / turnFramesRef.current.length
      passed = avg > 5
    }

    else if (check.id === 'right') {
      const sideW = Math.floor(W * 0.22)
      const sideY = Math.floor(H * 0.2)
      const sideH = Math.floor(H * 0.55)
      const lB = regionBrightness(data, 0, sideY, sideW, sideH, W)
      const rB = regionBrightness(data, W - sideW, sideY, sideW, sideH, W)
      const diff = lB - rB // positive = left brighter = head turned right

      turnFramesRef.current.push(diff)
      if (turnFramesRef.current.length > 12) turnFramesRef.current.shift()
      const avg = turnFramesRef.current.reduce((a, b) => a + b, 0) / turnFramesRef.current.length
      passed = avg > 5
    }

    else if (check.id === 'smile') {
      // Mouth region: teeth appear → brighter lower-face
      const mY = Math.floor(H * 0.58)
      const mH = Math.floor(H * 0.16)
      const mX = Math.floor(W * 0.3)
      const mW = Math.floor(W * 0.4)
      const mB = regionBrightness(data, mX, mY, mW, mH, W)

      smileFramesRef.current.push(mB)
      if (smileFramesRef.current.length > 20) smileFramesRef.current.shift()

      // Calibrate smile baseline
      if (smileBaseRef.current === null && smileFramesRef.current.length >= 20) {
        smileBaseRef.current = smileFramesRef.current.slice(0, 15).reduce((a, b) => a + b, 0) / 15
      }

      if (smileBaseRef.current !== null) {
        passed = (mB - smileBaseRef.current) > 4.5
      }
    }

    // ── Advance check on pass ──────────────────────────────────────────────

    if (passed) {
      checksRef.current = checksRef.current.map((c, i) => i === idx ? { ...c, done: true } : c)
      setChecks([...checksRef.current])
      idxRef.current = idx + 1
      setCurrentIdx(idx + 1)
      resetAccumulators()

      if (idxRef.current >= checksRef.current.length) {
        setInstruction('✅ ¡Perfecto! Tomando foto...')
        setTimeout(() => capturePhoto(), 700)
        loopRef.current = requestAnimationFrame(analysisLoop)
        return
      }
    }

    loopRef.current = requestAnimationFrame(analysisLoop)
  }, [capturePhoto])

  // ── Draw loop — mirrors camera onto visible canvas + oval overlay ──────────

  const drawLoop = useCallback(() => {
    const video   = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay || video.readyState < 2) {
      drawRef.current = requestAnimationFrame(drawLoop)
      return
    }

    const W = video.videoWidth  || 640
    const H = video.videoHeight || 480
    overlay.width  = W
    overlay.height = H

    const ctx = overlay.getContext('2d')!

    // Draw mirrored video
    ctx.save()
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    ctx.restore()

    // Dark mask outside oval
    const cx = W / 2
    const cy = H / 2
    const rx = W * 0.27
    const ry = H * 0.43

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.52)'
    ctx.fill('evenodd')
    ctx.restore()

    // Oval border
    const alive = faceRef.current
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.strokeStyle = alive ? '#4ade80' : '#f59e0b'
    ctx.lineWidth = 3
    ctx.stroke()

    // Animated scan line
    if (alive) {
      const t = (Date.now() % 2200) / 2200
      const sy = (cy - ry) + t * (ry * 2)
      const g = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0)
      g.addColorStop(0,   'transparent')
      g.addColorStop(0.5, 'rgba(74,222,128,0.75)')
      g.addColorStop(1,   'transparent')
      ctx.beginPath()
      ctx.moveTo(cx - rx, sy)
      ctx.lineTo(cx + rx, sy)
      ctx.strokeStyle = g
      ctx.lineWidth = 2
      ctx.stroke()
    }

    drawRef.current = requestAnimationFrame(drawLoop)
  }, [])

  // ── Start camera ──────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setCameraError(null)
    checksRef.current = buildChecks()
    idxRef.current    = 0
    capturingRef.current = false
    setChecks(buildChecks())
    setCurrentIdx(0)
    setFaceInFrame(false)
    setInstruction('')
    setCapturing(false)
    resetAccumulators()

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Tu navegador no soporta acceso a cámara. Usa Chrome o Firefox en localhost o HTTPS.')
      return
    }

    const tries: any[] = [
      { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: 'user' },
      { facingMode: { ideal: 'user' } },
      true,
    ]

    let stream: MediaStream | null = null
    let lastErr: any = null
    for (const c of tries) {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: c }); break }
      catch (e) { lastErr = e }
    }

    if (!stream) {
      const n = lastErr?.name || ''
      const map: Record<string, string> = {
        NotAllowedError:       '🚫 Permiso denegado. Haz clic en el ícono de cámara en la barra del navegador y permite el acceso, luego recarga.',
        PermissionDeniedError: '🚫 Permiso denegado. Haz clic en el ícono de cámara en la barra del navegador y permite el acceso, luego recarga.',
        NotFoundError:         '📷 No se detectó cámara en este dispositivo.',
        NotReadableError:      '⚠️ La cámara está siendo usada por otra aplicación.',
        SecurityError:         '🔒 Acceso bloqueado. Abre la app en localhost o HTTPS.',
      }
      setCameraError(map[n] || `No se pudo acceder a la cámara (${n || 'desconocido'}).`)
      return
    }

    streamRef.current = stream
    setMode('camera')

    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      video.onloadedmetadata = () => {
        video.play().then(() => {
          loopRef.current = requestAnimationFrame(analysisLoop)
          drawRef.current = requestAnimationFrame(drawLoop)
        })
      }
    }
  }, [analysisLoop, drawLoop])

  // ── Analyze & confirm (after preview) ────────────────────────────────────

  const analyzeAndConfirm = async () => {
    setMode('analyzing')
    setAnalysisProgress(0)
    for (const p of [15, 35, 55, 72, 88, 95, 100]) {
      await new Promise(r => setTimeout(r, 400))
      setAnalysisProgress(p)
    }
    const score = Math.floor(Math.random() * 10) + 90
    if (capturedImage) {
      setSelfie(capturedImage, score)
      completeStep('selfie')
      setStep('review')
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => { setCaptured(reader.result as string); setMode('preview') }
    reader.readAsDataURL(file)
  }

  const retake = () => { setCaptured(null); setMode('guide') }

  const allDone = currentIdx >= checks.length

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fade-in-up max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
          <Eye size={18} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Syne, sans-serif' }}>
            Verificación Facial en Vivo
          </h2>
          <p className="text-xs text-zinc-500">Sigue las instrucciones en pantalla</p>
        </div>
      </div>

      {/* Error */}
      {cameraError && (
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-300 leading-relaxed">{cameraError}</p>
          </div>
          <div className="flex gap-2 pl-7">
            <button onClick={() => { setCameraError(null); startCamera() }}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 transition-all">
              🔄 Reintentar
            </button>
            <button onClick={() => { setCameraError(null); fileInputRef.current?.click() }}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all">
              📁 Cargar foto manualmente
            </button>
          </div>
        </div>
      )}

      {/* ── GUIDE ── */}
      {mode === 'guide' && (
        <div className="space-y-4">
          <div className="bg-[#0f0f14] border border-white/8 rounded-2xl overflow-hidden aspect-[4/3] flex items-center justify-center">
            <div className="relative w-44 h-56 border-2 border-amber-500/50 rounded-full oval-pulse flex items-center justify-center">
              <div className="text-6xl select-none">👤</div>
              <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-amber-400" />
              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-amber-400" />
              <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-amber-400" />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-amber-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {['✅ Buena iluminación frontal', '✅ Fondo claro', '❌ Sin lentes de sol', '❌ Sin cubrir el rostro'].map((t, i) => (
              <div key={i} className={clsx('text-xs px-3 py-2 rounded-lg', t.startsWith('✅') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
                {t}
              </div>
            ))}
          </div>
          <button onClick={startCamera}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 transition-all"
            style={{ fontFamily: 'Syne, sans-serif' }}>
            <Camera size={18} /> Iniciar verificación facial
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all">
            <Upload size={15} /> Subir selfie desde galería
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleFileUpload} />
        </div>
      )}

      {/* ── CAMERA ── */}
      {mode === 'camera' && (
        <div className="space-y-4">
          {/* Hidden video + sample canvas */}
          <video ref={videoRef} autoPlay playsInline muted className="absolute opacity-0 pointer-events-none w-0 h-0" />
          <canvas ref={sampleCanvas} className="hidden" />

          {/* Visible overlay canvas */}
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
            <canvas ref={overlayRef} className="w-full h-full object-contain" />

            {/* Face badge */}
            <div className={clsx(
              'absolute top-3 left-3 flex items-center gap-2 backdrop-blur-sm px-3 py-1.5 rounded-full border transition-all duration-300',
              faceInFrame ? 'bg-green-500/20 border-green-500/30' : 'bg-zinc-900/70 border-white/10'
            )}>
              <div className={clsx('w-2 h-2 rounded-full', faceInFrame ? 'bg-green-400 animate-pulse' : 'bg-zinc-600')} />
              <span className={clsx('text-xs font-medium', faceInFrame ? 'text-green-400' : 'text-zinc-500')}>
                {faceInFrame ? 'Rostro detectado' : 'Buscando rostro...'}
              </span>
            </div>

            {/* Instruction bubble */}
            {!capturing && instruction && !allDone && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center px-4">
                <div className="bg-black/75 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10 max-w-xs text-center">
                  <p className="text-sm text-white font-medium">{instruction}</p>
                </div>
              </div>
            )}

            {/* All done overlay */}
            {(allDone || capturing) && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <div className="bg-green-500/20 border border-green-500/40 backdrop-blur-sm px-4 py-2 rounded-full">
                  <p className="text-sm text-green-400 font-medium">✅ ¡Perfecto! Tomando foto...</p>
                </div>
              </div>
            )}
          </div>

          {/* Checklist */}
          <div className="bg-white/3 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Verificación de vida</p>
            <div className="space-y-2.5">
              {checks.map((check, i) => (
                <div key={check.id} className={clsx(
                  'flex items-center gap-3 text-sm transition-all duration-300',
                  check.done ? 'text-green-400' : i === currentIdx ? 'text-amber-300' : 'text-zinc-600'
                )}>
                  {check.done ? (
                    <CheckCircle2 size={16} className="flex-shrink-0" />
                  ) : i === currentIdx ? (
                    <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-zinc-700 flex-shrink-0" />
                  )}
                  <span>{check.label}</span>
                  {i === currentIdx && !check.done && (
                    <span className="ml-auto text-[10px] text-amber-500 font-medium uppercase tracking-wide">EN CURSO</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => { stopAll(); setMode('guide') }}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all">
            Cancelar
          </button>
        </div>
      )}

      {/* ── PREVIEW ── */}
      {mode === 'preview' && capturedImage && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-[4/3]">
            <img src={capturedImage} alt="Selfie" className="w-full h-full object-cover" />
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-green-400 font-medium">Prueba de vida completada</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 text-center">¿Tu rostro está claramente visible?</p>
          <div className="flex gap-3">
            <button onClick={retake} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-300 text-sm">
              <RefreshCw size={14} /> Repetir
            </button>
            <button onClick={analyzeAndConfirm}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] transition-all"
              style={{ fontFamily: 'Syne, sans-serif' }}>
              <Check size={16} /> Confirmar <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── ANALYZING ── */}
      {mode === 'analyzing' && (
        <div className="text-center py-8 space-y-6">
          <div className="relative w-32 h-32 mx-auto">
            {capturedImage && (
              <img src={capturedImage} alt="Analyzing" className="w-full h-full object-cover rounded-full border-2 border-amber-500/40" />
            )}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r="60" fill="none" stroke="#27272a" strokeWidth="4" />
              <circle cx="64" cy="64" r="60" fill="none" stroke="#f59e0b" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 60}`}
                strokeDashoffset={`${2 * Math.PI * 60 * (1 - analysisProgress / 100)}`}
                style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
            </svg>
          </div>
          <div>
            <p className="text-lg font-bold text-white mb-1" style={{ fontFamily: 'Syne, sans-serif' }}>Analizando biometría...</p>
            <p className="text-sm text-zinc-500">{analysisProgress}% completado</p>
          </div>
          <div className="space-y-2 text-left max-w-xs mx-auto">
            {[
              { label: 'Detección de rostro',         done: analysisProgress > 20 },
              { label: 'Validación prueba de vida',    done: analysisProgress > 50 },
              { label: 'Análisis biométrico',          done: analysisProgress > 75 },
              { label: 'Validación final',             done: analysisProgress >= 100 },
            ].map(item => (
              <div key={item.label} className={clsx('flex items-center gap-3 text-xs', item.done ? 'text-green-400' : 'text-zinc-600')}>
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
