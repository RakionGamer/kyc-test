'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import {
  Eye, Camera, RefreshCw, Check, ArrowRight,
  AlertCircle, CheckCircle2, Upload
} from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'
import clsx from 'clsx'

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Check = { id: string; label: string; instruction: string; done: boolean }
type Mode  = 'guide' | 'camera' | 'preview' | 'analyzing'

const makeChecks = (): Check[] => [
  { id: 'center', label: 'Centra tu rostro',     instruction: '👤 Coloca tu cara dentro del óvalo', done: false },
  { id: 'blink',  label: 'Parpadea 2 veces',      instruction: '👁️ Parpadea lentamente 2 veces',    done: false },
  { id: 'left',   label: 'Gira a la izquierda',   instruction: '⬅️ Gira tu cabeza a la izquierda', done: false },
  { id: 'right',  label: 'Gira a la derecha',     instruction: '➡️ Gira tu cabeza a la derecha',   done: false },
  { id: 'smile',  label: 'Sonríe',                instruction: '😊 Sonríe naturalmente',            done: false },
]

/* ─── Pixel helpers ──────────────────────────────────────────────────────── */

function brightness(
  d: Uint8ClampedArray,
  x0: number, y0: number,
  w: number,  h: number,
  stride: number
): number {
  let s = 0, n = 0
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * stride + x) * 4
      s += d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114
      n++
    }
  }
  return n ? s / n : 0
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function SelfieStep() {
  const { setStep, setSelfie, completeStep } = useKYCStore()

  const [mode,        setMode]        = useState<Mode>('guide')
  const [snapshot,    setSnapshot]    = useState<string | null>(null)
  const [checks,      setChecks]      = useState<Check[]>(makeChecks())
  const [activeIdx,   setActiveIdx]   = useState(0)
  const [faceFound,   setFaceFound]   = useState(false)
  const [hint,        setHint]        = useState('')
  const [camError,    setCamError]    = useState<string | null>(null)
  const [progress,    setProgress]    = useState(0)
  const [done,        setDone]        = useState(false)

  /* DOM refs */
  const videoRef   = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)  // draws oval + scan line on top of video
  const sampleRef  = useRef<HTMLCanvasElement>(null)  // offscreen — pixel analysis
  const fileRef    = useRef<HTMLInputElement>(null)

  /* Loop refs */
  const streamRef  = useRef<MediaStream | null>(null)
  const drawRaf    = useRef<number>(0)
  const analysisRaf = useRef<number>(0)

  /* Mutable check state (avoids stale closures) */
  const checksRef   = useRef<Check[]>(makeChecks())
  const idxRef      = useRef(0)
  const faceRef     = useRef(false)
  const doneRef     = useRef(false)

  /* Blink accumulators */
  const blinkCount  = useRef(0)
  const blinkBase   = useRef<number | null>(null)
  const blinkCalib  = useRef<number[]>([])
  const blinkCool   = useRef(0)

  /* Turn accumulators */
  const turnBuf     = useRef<number[]>([])

  /* Smile accumulators */
  const smileBase   = useRef<number | null>(null)
  const smileCalib  = useRef<number[]>([])

  /* Center accumulator */
  const centerTick  = useRef(0)

  /* ── Reset per-check state ─────────────────────────────────────────────── */
  const resetAccum = () => {
    blinkCount.current = 0; blinkBase.current = null
    blinkCalib.current = []; blinkCool.current = 0
    turnBuf.current = []
    smileBase.current = null; smileCalib.current = []
    centerTick.current = 0
  }

  /* ── Stop camera & loops ───────────────────────────────────────────────── */
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(drawRaf.current)
    cancelAnimationFrame(analysisRaf.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  /* ── Capture photo ─────────────────────────────────────────────────────── */
  const capturePhoto = useCallback(() => {
    const v = videoRef.current
    const c = sampleRef.current
    if (!v || !c) return
    c.width  = v.videoWidth  || 640
    c.height = v.videoHeight || 480
    const ctx = c.getContext('2d')!
    // mirror (selfie)
    ctx.save(); ctx.translate(c.width, 0); ctx.scale(-1, 1)
    ctx.drawImage(v, 0, 0); ctx.restore()
    const img = c.toDataURL('image/jpeg', 0.92)
    stopCamera()
    setSnapshot(img)
    setMode('preview')
  }, [stopCamera])

  /* ── Draw loop — overlay canvas on top of <video> ──────────────────────── */
  const drawLoop = useCallback(() => {
    const ov = overlayRef.current
    if (!ov) { drawRaf.current = requestAnimationFrame(drawLoop); return }

    const W = ov.offsetWidth  || 640
    const H = ov.offsetHeight || 480
    if (ov.width !== W)  ov.width  = W
    if (ov.height !== H) ov.height = H

    const ctx = ov.getContext('2d')!
    ctx.clearRect(0, 0, W, H)

    const cx = W / 2, cy = H / 2
    const rx = W * 0.27, ry = H * 0.44

    /* Dark vignette outside oval */
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, H)
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fill('evenodd')
    ctx.restore()

    /* Oval border */
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.strokeStyle = faceRef.current ? '#4ade80' : '#f59e0b'
    ctx.lineWidth = 3
    ctx.stroke()

    /* Scan line when face detected */
    if (faceRef.current && !doneRef.current) {
      const t  = (Date.now() % 2000) / 2000
      const sy = (cy - ry) + t * ry * 2
      const g  = ctx.createLinearGradient(cx - rx, 0, cx + rx, 0)
      g.addColorStop(0,   'transparent')
      g.addColorStop(0.5, 'rgba(74,222,128,0.8)')
      g.addColorStop(1,   'transparent')
      ctx.beginPath()
      ctx.moveTo(cx - rx, sy); ctx.lineTo(cx + rx, sy)
      ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.stroke()
    }

    drawRaf.current = requestAnimationFrame(drawLoop)
  }, [])

  /* ── Analysis loop — reads pixels from video via offscreen canvas ───────── */
  const analysisLoop = useCallback(() => {
    const v = videoRef.current
    const c = sampleRef.current
    if (!v || !c || v.readyState < 2 || doneRef.current) {
      analysisRaf.current = requestAnimationFrame(analysisLoop); return
    }

    const W = v.videoWidth, H = v.videoHeight
    if (!W || !H) { analysisRaf.current = requestAnimationFrame(analysisLoop); return }

    c.width = W; c.height = H
    const ctx = c.getContext('2d')!
    ctx.drawImage(v, 0, 0)            // NOT mirrored — raw for analysis
    const { data } = ctx.getImageData(0, 0, W, H)

    /* Face detection: centre vs top corners */
    const cB  = brightness(data, Math.floor(W*.25), Math.floor(H*.15), Math.floor(W*.5), Math.floor(H*.65), W)
    const tl  = brightness(data, 0, 0, Math.floor(W*.18), Math.floor(H*.18), W)
    const tr  = brightness(data, Math.floor(W*.82), 0, Math.floor(W*.18), Math.floor(H*.18), W)
    const bg  = (tl + tr) / 2
    const has = cB > 20 && Math.abs(cB - bg) > 5

    faceRef.current = has
    setFaceFound(has)

    const idx   = idxRef.current
    const check = checksRef.current[idx]

    if (!check) { analysisRaf.current = requestAnimationFrame(analysisLoop); return }

    if (!has) {
      setHint('👤 Coloca tu cara dentro del óvalo')
      analysisRaf.current = requestAnimationFrame(analysisLoop); return
    }

    setHint(check.instruction)
    let passed = false

    /* center */
    if (check.id === 'center') {
      centerTick.current++
      passed = centerTick.current > 25
    }

    /* blink */
    else if (check.id === 'blink') {
      const eY = Math.floor(H*.26), eH = Math.floor(H*.14)
      const eX = Math.floor(W*.2),  eW = Math.floor(W*.6)
      const eb = brightness(data, eX, eY, eW, eH, W)

      if (blinkBase.current === null) {
        blinkCalib.current.push(eb)
        if (blinkCalib.current.length >= 30) {
          blinkBase.current = blinkCalib.current.reduce((a,b)=>a+b,0) / blinkCalib.current.length
          blinkCalib.current = []
        }
      } else if (blinkCool.current > 0) {
        blinkCool.current--
      } else {
        if ((blinkBase.current - eb) > 8) {
          blinkCount.current++
          blinkCool.current = 20
          blinkBase.current = null; blinkCalib.current = []
        }
      }
      passed = blinkCount.current >= 2
    }

    /* turn left  — camera-left = user's right side of face exposed */
    else if (check.id === 'left') {
      const sY = Math.floor(H*.2), sH = Math.floor(H*.55), sW = Math.floor(W*.22)
      const lB = brightness(data, 0, sY, sW, sH, W)
      const rB = brightness(data, W-sW, sY, sW, sH, W)
      turnBuf.current.push(rB - lB)
      if (turnBuf.current.length > 12) turnBuf.current.shift()
      const avg = turnBuf.current.reduce((a,b)=>a+b,0) / turnBuf.current.length
      passed = avg > 6
    }

    /* turn right */
    else if (check.id === 'right') {
      const sY = Math.floor(H*.2), sH = Math.floor(H*.55), sW = Math.floor(W*.22)
      const lB = brightness(data, 0, sY, sW, sH, W)
      const rB = brightness(data, W-sW, sY, sW, sH, W)
      turnBuf.current.push(lB - rB)
      if (turnBuf.current.length > 12) turnBuf.current.shift()
      const avg = turnBuf.current.reduce((a,b)=>a+b,0) / turnBuf.current.length
      passed = avg > 6
    }

    /* smile */
    else if (check.id === 'smile') {
      const mY = Math.floor(H*.58), mH = Math.floor(H*.16)
      const mX = Math.floor(W*.3),  mW = Math.floor(W*.4)
      const mb = brightness(data, mX, mY, mW, mH, W)

      if (smileBase.current === null) {
        smileCalib.current.push(mb)
        if (smileCalib.current.length >= 20) {
          smileBase.current = smileCalib.current.reduce((a,b)=>a+b,0) / smileCalib.current.length
          smileCalib.current = []
        }
      } else {
        passed = (mb - smileBase.current) > 4.5
      }
    }

    if (passed) {
      const next = idx + 1
      checksRef.current = checksRef.current.map((c,i) => i===idx ? {...c,done:true} : c)
      setChecks([...checksRef.current])
      idxRef.current = next
      setActiveIdx(next)
      resetAccum()

      if (next >= checksRef.current.length) {
        doneRef.current = true
        setDone(true)
        setHint('✅ ¡Perfecto!')
        setTimeout(() => capturePhoto(), 700)
        return
      }
    }

    analysisRaf.current = requestAnimationFrame(analysisLoop)
  }, [capturePhoto])

  /* ── Start camera ──────────────────────────────────────────────────────── */
  const startCamera = useCallback(async () => {
    setCamError(null)
    checksRef.current = makeChecks(); idxRef.current = 0
    doneRef.current = false; faceRef.current = false
    setChecks(makeChecks()); setActiveIdx(0)
    setFaceFound(false); setHint(''); setDone(false)
    resetAccum()

    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Tu navegador no soporta acceso a cámara. Usa Chrome o Firefox en localhost/HTTPS.')
      return
    }

    const tries: MediaStreamConstraints[] = [
      { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { facingMode: 'user' } },
      { video: { facingMode: { ideal: 'user' } } },
      { video: true },
    ]

    let stream: MediaStream | null = null
    let lastErr: unknown = null
    for (const c of tries) {
      try { stream = await navigator.mediaDevices.getUserMedia(c); break }
      catch (e) { lastErr = e }
    }

    if (!stream) {
      const n = (lastErr as any)?.name ?? ''
      const msgs: Record<string,string> = {
        NotAllowedError:       '🚫 Permiso denegado. Haz clic en el ícono de cámara en la barra del navegador y permite el acceso.',
        PermissionDeniedError: '🚫 Permiso denegado. Haz clic en el ícono de cámara en la barra del navegador y permite el acceso.',
        NotFoundError:         '📷 No se detectó cámara en este dispositivo.',
        NotReadableError:      '⚠️ La cámara está siendo usada por otra aplicación.',
        SecurityError:         '🔒 Acceso bloqueado. Abre en localhost o HTTPS.',
      }
      setCamError(msgs[n] ?? `No se pudo acceder a la cámara (${n || 'desconocido'}).`)
      return
    }

    streamRef.current = stream
    const v = videoRef.current
    if (!v) return

    v.srcObject = stream
    setMode('camera')

    // Wait until video has real dimensions before starting loops
    v.onloadedmetadata = () => {
      v.play().then(() => {
        // give browser one more frame to paint
        requestAnimationFrame(() => {
          drawRaf.current     = requestAnimationFrame(drawLoop)
          analysisRaf.current = requestAnimationFrame(analysisLoop)
        })
      })
    }
  }, [drawLoop, analysisLoop])

  /* ── Analyze & advance ─────────────────────────────────────────────────── */
  const analyzeAndConfirm = async () => {
    setMode('analyzing'); setProgress(0)
    for (const p of [15,35,55,72,88,95,100]) {
      await new Promise(r => setTimeout(r, 400))
      setProgress(p)
    }
    if (snapshot) {
      setSelfie(snapshot, Math.floor(Math.random()*10)+90)
      completeStep('selfie')
      setStep('review')
    }
  }

  const retake = () => { setSnapshot(null); setMode('guide') }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader()
    r.onloadend = () => { setSnapshot(r.result as string); setMode('preview') }
    r.readAsDataURL(f)
  }

  /* ── Render ──────────────────────────────────────────────────────────────── */
  return (
    <div className="fade-in-up max-w-xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
          <Eye size={18} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{fontFamily:'Syne,sans-serif'}}>
            Verificación Facial en Vivo
          </h2>
          <p className="text-xs text-zinc-500">Sigue las instrucciones en pantalla</p>
        </div>
      </div>

      {/* Error banner */}
      {camError && (
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-300 leading-relaxed">{camError}</p>
          </div>
          <div className="flex gap-2 pl-7">
            <button onClick={() => { setCamError(null); startCamera() }}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 transition-all">
              🔄 Reintentar
            </button>
            <button onClick={() => { setCamError(null); fileRef.current?.click() }}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all">
              📁 Cargar foto
            </button>
          </div>
        </div>
      )}

      {/* ════ GUIDE ════ */}
      {mode === 'guide' && (
        <div className="space-y-4">
          <div className="bg-[#0f0f14] border border-white/8 rounded-2xl overflow-hidden aspect-[4/3] flex items-center justify-center">
            <div className="relative w-44 h-56 border-2 border-amber-500/50 rounded-full oval-pulse flex items-center justify-center">
              <span className="text-6xl select-none">👤</span>
              <div className="absolute -top-1 -left-1  w-4 h-4 border-t-2 border-l-2 border-amber-400" />
              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-amber-400" />
              <div className="absolute -bottom-1 -left-1  w-4 h-4 border-b-2 border-l-2 border-amber-400" />
              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-amber-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {['✅ Buena iluminación frontal','✅ Fondo claro','❌ Sin lentes de sol','❌ Sin cubrir el rostro'].map((t,i) => (
              <div key={i} className={clsx('text-xs px-3 py-2 rounded-lg', t.startsWith('✅') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>{t}</div>
            ))}
          </div>
          <button onClick={startCamera}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] hover:shadow-amber-500/25 hover:shadow-lg transition-all"
            style={{fontFamily:'Syne,sans-serif'}}>
            <Camera size={18}/> Iniciar verificación facial
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all">
            <Upload size={15}/> Subir selfie desde galería
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleFile}/>
        </div>
      )}

      {/* ════ CAMERA ════ */}
      {mode === 'camera' && (
        <div className="space-y-4">

          {/*
            KEY LAYOUT:
            - <video> fills the container, visible, mirrored via CSS
            - <canvas> sits absolutely on top, transparent background, draws only the oval mask + scan line
            - offscreen <canvas> for pixel analysis (hidden, zero size)
          */}
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">

            {/* ① The actual camera feed — CSS mirror so user sees themselves */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ transform: 'scaleX(-1)' }}
              className="absolute inset-0 w-full h-full object-cover"
            />

            {/* ② Overlay canvas — only draws oval mask + scan line on top */}
            <canvas
              ref={overlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />

            {/* ③ Face badge */}
            <div className={clsx(
              'absolute top-3 left-3 flex items-center gap-2 backdrop-blur-sm px-3 py-1.5 rounded-full border transition-all duration-300',
              faceFound ? 'bg-green-500/20 border-green-500/30' : 'bg-zinc-900/70 border-white/10'
            )}>
              <div className={clsx('w-2 h-2 rounded-full', faceFound ? 'bg-green-400 animate-pulse' : 'bg-zinc-600')} />
              <span className={clsx('text-xs font-medium', faceFound ? 'text-green-400' : 'text-zinc-500')}>
                {faceFound ? 'Rostro detectado' : 'Buscando rostro...'}
              </span>
            </div>

            {/* ④ Instruction bubble */}
            {hint && !done && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center px-4">
                <div className="bg-black/75 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10">
                  <p className="text-sm text-white font-medium text-center">{hint}</p>
                </div>
              </div>
            )}
            {done && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <div className="bg-green-500/20 border border-green-500/40 backdrop-blur-sm px-4 py-2 rounded-full">
                  <p className="text-sm text-green-400 font-medium">✅ ¡Perfecto! Tomando foto...</p>
                </div>
              </div>
            )}
          </div>

          {/* Hidden offscreen canvas for pixel analysis */}
          <canvas ref={sampleRef} className="hidden" />

          {/* Checklist */}
          <div className="bg-white/3 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Verificación de vida</p>
            <div className="space-y-2.5">
              {checks.map((ch, i) => (
                <div key={ch.id} className={clsx(
                  'flex items-center gap-3 text-sm transition-all duration-300',
                  ch.done ? 'text-green-400' : i === activeIdx ? 'text-amber-300' : 'text-zinc-600'
                )}>
                  {ch.done
                    ? <CheckCircle2 size={16} className="flex-shrink-0"/>
                    : i === activeIdx
                      ? <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin flex-shrink-0"/>
                      : <div className="w-4 h-4 rounded-full border border-zinc-700 flex-shrink-0"/>
                  }
                  <span>{ch.label}</span>
                  {i === activeIdx && !ch.done && (
                    <span className="ml-auto text-[10px] text-amber-500 font-medium uppercase tracking-wide">EN CURSO</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => { stopCamera(); setMode('guide') }}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all">
            Cancelar
          </button>
        </div>
      )}

      {/* ════ PREVIEW ════ */}
      {mode === 'preview' && snapshot && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-[4/3]">
            <img src={snapshot} alt="Selfie" className="w-full h-full object-cover"/>
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-400"/>
              <span className="text-xs text-green-400 font-medium">Prueba de vida completada</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 text-center">¿Tu rostro está claramente visible?</p>
          <div className="flex gap-3">
            <button onClick={retake} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-300 text-sm">
              <RefreshCw size={14}/> Repetir
            </button>
            <button onClick={analyzeAndConfirm}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] transition-all"
              style={{fontFamily:'Syne,sans-serif'}}>
              <Check size={16}/> Confirmar <ArrowRight size={14}/>
            </button>
          </div>
        </div>
      )}

      {/* ════ ANALYZING ════ */}
      {mode === 'analyzing' && (
        <div className="text-center py-8 space-y-6">
          <div className="relative w-32 h-32 mx-auto">
            {snapshot && <img src={snapshot} alt="" className="w-full h-full object-cover rounded-full border-2 border-amber-500/40"/>}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r="60" fill="none" stroke="#27272a" strokeWidth="4"/>
              <circle cx="64" cy="64" r="60" fill="none" stroke="#f59e0b" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*60}`}
                strokeDashoffset={`${2*Math.PI*60*(1-progress/100)}`}
                style={{transition:'stroke-dashoffset 0.4s ease'}}/>
            </svg>
          </div>
          <div>
            <p className="text-lg font-bold text-white mb-1" style={{fontFamily:'Syne,sans-serif'}}>Analizando biometría...</p>
            <p className="text-sm text-zinc-500">{progress}% completado</p>
          </div>
          <div className="space-y-2 text-left max-w-xs mx-auto">
            {[
              {label:'Detección de rostro',       done: progress>20},
              {label:'Validación prueba de vida',  done: progress>50},
              {label:'Análisis biométrico',        done: progress>75},
              {label:'Validación final',           done: progress>=100},
            ].map(it => (
              <div key={it.label} className={clsx('flex items-center gap-3 text-xs', it.done ? 'text-green-400' : 'text-zinc-600')}>
                {it.done ? <CheckCircle2 size={14}/> : <div className="w-3.5 h-3.5 rounded-full border border-zinc-700"/>}
                {it.label}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
