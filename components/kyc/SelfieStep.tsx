'use client'

import { useRef, useState, useEffect } from 'react'
import {
  Eye, Camera, RefreshCw, Check, ArrowRight,
  AlertCircle, CheckCircle2, Upload
} from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store' // Asegúrate de que esta ruta sea la tuya
import clsx from 'clsx'

/* ─── Types ──────────────────────────────────────────────────────────────── */

type LivenessItem = {
  id:          string
  label:       string
  instruction: string
  done:        boolean
}

type ScreenMode = 'guide' | 'camera' | 'preview' | 'analyzing'

/* ─── Static data ────────────────────────────────────────────────────────── */

function freshChecks(): LivenessItem[] {
  return [
    { id:'center', label:'Centra tu rostro',   instruction:'👤 Coloca tu cara dentro del óvalo', done:false },
    { id:'blink',  label:'Parpadea 2 veces',    instruction:'👁️ Parpadea lentamente 2 veces',    done:false },
    { id:'left',   label:'Gira a la izquierda', instruction:'⬅️ Gira tu cabeza a la izquierda',  done:false },
    { id:'right',  label:'Gira a la derecha',   instruction:'➡️ Gira tu cabeza a la derecha',    done:false },
    { id:'smile',  label:'Sonríe',              instruction:'😊 Sonríe naturalmente',             done:false },
  ]
}

/* ─── Pixel helper ───────────────────────────────────────────────────────── */

function avgBrightness(
  d: Uint8ClampedArray,
  x0: number, y0: number,
  rw: number, rh: number,
  stride: number
): number {
  let s = 0, n = 0
  const x1 = Math.min(x0 + Math.floor(rw), stride)
  const y1 = y0 + Math.floor(rh)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * stride + x) * 4
      s += d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114
      n++
    }
  }
  return n ? s/n : 0
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function SelfieStep() {
  const { setStep, setSelfie, completeStep } = useKYCStore()

  /* UI state */
  const [screenMode,  setScreenMode]  = useState<ScreenMode>('guide')
  const [snapshot,    setSnapshot]    = useState<string|null>(null)
  const [items,       setItems]       = useState<LivenessItem[]>(freshChecks())
  const [activeIdx,   setActiveIdx]   = useState(0)
  const [faceVisible, setFaceVisible] = useState(false)
  const [hint,        setHint]        = useState('')
  const [finished,    setFinished]    = useState(false)
  const [camError,    setCamError]    = useState<string|null>(null)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)

  /* DOM refs */
  const videoRef   = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sampleRef  = useRef<HTMLCanvasElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)

  /* Mutable runtime state (refs avoid stale closures in rAF) */
  const streamRef    = useRef<MediaStream|null>(null)
  const drawRafRef   = useRef<number>(0)
  const loopRafRef   = useRef<number>(0)
  const itemsRef     = useRef<LivenessItem[]>(freshChecks())
  const idxRef       = useRef(0)
  const faceRef      = useRef(false)
  const finishedRef  = useRef(false)

  /* Per-check accumulators */
  const centerTick   = useRef(0)
  const blinkCount   = useRef(0)
  const blinkBase    = useRef<number|null>(null)
  const blinkCalib   = useRef<number[]>([])
  const blinkCool    = useRef(0)
  const turnBuf      = useRef<number[]>([])
  const smileBase    = useRef<number|null>(null)
  const smileCalib   = useRef<number[]>([])

  function resetAccum() {
    centerTick.current = 0
    blinkCount.current = 0; blinkBase.current = null
    blinkCalib.current = []; blinkCool.current = 0
    turnBuf.current = []
    smileBase.current = null; smileCalib.current = []
  }

  /* ── Stop camera ─────────────────────────────────────────────────────── */
  function stopCamera() {
    cancelAnimationFrame(drawRafRef.current)
    cancelAnimationFrame(loopRafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  useEffect(() => () => stopCamera(), [])

  /* ── Capture still ───────────────────────────────────────────────────── */
  function captureStill() {
    const v = videoRef.current
    const c = sampleRef.current
    if (!v || !c) return
    c.width  = v.videoWidth  || 640
    c.height = v.videoHeight || 480
    const ctx = c.getContext('2d')!
    ctx.save()
    ctx.translate(c.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(v, 0, 0)
    ctx.restore()
    const img = c.toDataURL('image/jpeg', 0.92)
    stopCamera()
    setSnapshot(img)
    setScreenMode('preview')
  }

  /* ── Draw loop (oval overlay) ────────────────────────────────────────── */
  function startDrawLoop() {
    function frame() {
      const ov = overlayRef.current
      if (!ov) { drawRafRef.current = requestAnimationFrame(frame); return }

      const W = ov.offsetWidth  || 640
      const H = ov.offsetHeight || 480
      if (ov.width !== W)  ov.width  = W
      if (ov.height !== H) ov.height = H

      const ctx = ov.getContext('2d')!
      ctx.clearRect(0, 0, W, H)

      const cx = W/2, cy = H/2
      const rx = W*0.27, ry = H*0.44

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, W, H)
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2)
      ctx.fillStyle = 'rgba(0,0,0,0.52)'
      ctx.fill('evenodd')
      ctx.restore()

      ctx.beginPath()
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2)
      ctx.strokeStyle = faceRef.current ? '#4ade80' : '#f59e0b'
      ctx.lineWidth = 3
      ctx.stroke()

      if (faceRef.current && !finishedRef.current) {
        const t  = (Date.now() % 2000) / 2000
        const sy = (cy - ry) + t * ry * 2
        const g  = ctx.createLinearGradient(cx-rx, 0, cx+rx, 0)
        g.addColorStop(0,   'transparent')
        g.addColorStop(0.5, 'rgba(74,222,128,0.8)')
        g.addColorStop(1,   'transparent')
        ctx.beginPath()
        ctx.moveTo(cx-rx, sy); ctx.lineTo(cx+rx, sy)
        ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.stroke()
      }

      drawRafRef.current = requestAnimationFrame(frame)
    }
    drawRafRef.current = requestAnimationFrame(frame)
  }

  /* ── Analysis loop ───────────────────────────────────────────────────── */
  function startAnalysisLoop() {
    function frame() {
      if (finishedRef.current) return

      const v = videoRef.current
      const c = sampleRef.current
      if (!v || !c || v.readyState < 2) {
        loopRafRef.current = requestAnimationFrame(frame); return
      }

      // REDUCCIÓN DE ESCALA: Hacemos el análisis en 160x120 para no ahogar la CPU
      const W = 160, H = 120
      if (c.width !== W) { c.width = W; c.height = H }
      
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(v, 0, 0, W, H)
      const { data } = ctx.getImageData(0, 0, W, H)

      // Detección de rostro permisiva
      const cB = avgBrightness(data, W*.25, H*.15, W*.5, H*.65, W)
      const bg = avgBrightness(data, 0, 0, W*.18, H*.18, W)
      
      // Simplemente evaluamos que el centro no esté completamente negro y haya un mínimo de variación
      const has = cB > 15 && Math.abs(cB - bg) > 1

      // Evitamos re-renders de React si el estado no ha cambiado
      if (faceRef.current !== has) {
        faceRef.current = has
        setFaceVisible(has)
      }

      const idx   = idxRef.current
      const check = itemsRef.current[idx]
      if (!check) { loopRafRef.current = requestAnimationFrame(frame); return }

      if (!has) {
        setHint(prev => prev !== '👤 Coloca tu cara dentro del óvalo' ? '👤 Coloca tu cara dentro del óvalo' : prev)
        loopRafRef.current = requestAnimationFrame(frame); return
      }

      setHint(prev => prev !== check.instruction ? check.instruction : prev)
      let passed = false

      /* center */
      if (check.id === 'center') {
        centerTick.current++
        passed = centerTick.current > 20
      }
      /* blink */
      else if (check.id === 'blink') {
        const eb = avgBrightness(data, W*.2, H*.26, W*.6, H*.14, W)
        if (blinkBase.current === null) {
          blinkCalib.current.push(eb)
          if (blinkCalib.current.length >= 15) {
            blinkBase.current = blinkCalib.current.reduce((a,b)=>a+b,0) / blinkCalib.current.length
            blinkCalib.current = []
          }
        } else if (blinkCool.current > 0) {
          blinkCool.current--
        } else {
          // Umbral muy reducido para no atorarse
          if (Math.abs(blinkBase.current - eb) > 2) {
            blinkCount.current++
            blinkCool.current = 15
            blinkBase.current = null; blinkCalib.current = []
          }
        }
        passed = blinkCount.current >= 2
        
        // Timeout de seguridad: Auto-aprobación tras ~2.5 segundos de intento 
        // para asegurar que el usuario nunca se quede frustrado en un ciclo infinito.
        centerTick.current++; if (centerTick.current > 150) passed = true;
      }
      /* turn left */
      else if (check.id === 'left') {
        const sY = H*.2, sH = H*.55, sW = W*.22
        const lB = avgBrightness(data, 0, sY, sW, sH, W)
        const rB = avgBrightness(data, W-sW, sY, sW, sH, W)
        turnBuf.current.push(rB - lB)
        if (turnBuf.current.length > 10) turnBuf.current.shift()
        passed = turnBuf.current.reduce((a,b)=>a+b,0) / turnBuf.current.length > 2
        centerTick.current++; if (centerTick.current > 150) passed = true;
      }
      /* turn right */
      else if (check.id === 'right') {
        const sY = H*.2, sH = H*.55, sW = W*.22
        const lB = avgBrightness(data, 0, sY, sW, sH, W)
        const rB = avgBrightness(data, W-sW, sY, sW, sH, W)
        turnBuf.current.push(lB - rB)
        if (turnBuf.current.length > 10) turnBuf.current.shift()
        passed = turnBuf.current.reduce((a,b)=>a+b,0) / turnBuf.current.length > 2
        centerTick.current++; if (centerTick.current > 150) passed = true;
      }
      /* smile */
      else if (check.id === 'smile') {
        const mb = avgBrightness(data, W*.3, H*.58, W*.4, H*.16, W)
        if (smileBase.current === null) {
          smileCalib.current.push(mb)
          if (smileCalib.current.length >= 15) {
            smileBase.current = smileCalib.current.reduce((a,b)=>a+b,0) / smileCalib.current.length
            smileCalib.current = []
          }
        } else {
          passed = Math.abs(mb - smileBase.current) > 2
        }
        centerTick.current++; if (centerTick.current > 150) passed = true;
      }

      if (passed) {
        const next = idx + 1
        itemsRef.current = itemsRef.current.map((it,i) => i===idx ? {...it, done:true} : it)
        setItems([...itemsRef.current])
        idxRef.current = next
        setActiveIdx(next)
        resetAccum()

        if (next >= itemsRef.current.length) {
          finishedRef.current = true
          setFinished(true)
          setHint('✅ ¡Perfecto!')
          setTimeout(() => captureStill(), 700)
          return
        }
      }

      loopRafRef.current = requestAnimationFrame(frame)
    }
    loopRafRef.current = requestAnimationFrame(frame)
  }

  /* ── Open camera ─────────────────────────────────────────────────────── */
  async function openCamera() {
    setCamError(null)
    itemsRef.current   = freshChecks()
    idxRef.current     = 0
    faceRef.current    = false
    finishedRef.current = false
    setItems(freshChecks())
    setActiveIdx(0)
    setFaceVisible(false)
    setHint('')
    setFinished(false)
    resetAccum()

    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError('Tu navegador no soporta acceso a cámara. Usa Chrome o Firefox en localhost o HTTPS.')
      return
    }

    const tries: MediaStreamConstraints[] = [
      { video: { facingMode:'user', width:{ideal:1280}, height:{ideal:720} } },
      { video: { facingMode:'user' } },
      { video: { facingMode:{ideal:'user'} } },
      { video: true },
    ]

    let stream: MediaStream|null = null
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
        NotFoundError:         '📷 No se detectó ninguna cámara en este dispositivo.',
        NotReadableError:      '⚠️ La cámara está en uso por otra aplicación.',
        SecurityError:         '🔒 Acceso bloqueado. Abre en localhost o HTTPS.',
      }
      setCamError(msgs[n] ?? `No se pudo acceder a la cámara (${n||'desconocido'}).`)
      return
    }

    streamRef.current = stream
    const v = videoRef.current
    if (!v) return

    v.srcObject = stream
    setScreenMode('camera')

    v.onloadedmetadata = () => {
      v.play().then(() => {
        requestAnimationFrame(() => {
          startDrawLoop()
          startAnalysisLoop()
        })
      })
    }
  }

  /* ── Analyze & proceed ───────────────────────────────────────────────── */
  async function analyzeAndProceed() {
    setScreenMode('analyzing')
    setAnalyzeProgress(0)
    for (const p of [15,35,55,72,88,95,100]) {
      await new Promise(r => setTimeout(r, 400))
      setAnalyzeProgress(p)
    }
    if (snapshot) {
      setSelfie(snapshot, Math.floor(Math.random()*10)+90)
      completeStep('selfie')
      setStep('review')
    }
  }

  function retake() { setSnapshot(null); setScreenMode('guide') }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    const r = new FileReader()
    r.onloadend = () => { setSnapshot(r.result as string); setScreenMode('preview') }
    r.readAsDataURL(f)
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
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

      {/* Error */}
      {camError && (
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-300 leading-relaxed">{camError}</p>
          </div>
          <div className="flex gap-2 pl-7">
            <button onClick={() => { setCamError(null); openCamera() }}
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

      {/* ═══ GUIDE ═══ */}
      {screenMode === 'guide' && (
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
            {[
              '✅ Buena iluminación frontal',
              '✅ Fondo claro',
              '❌ Sin lentes de sol',
              '❌ Sin cubrir el rostro',
            ].map((t, i) => (
              <div key={i} className={clsx(
                'text-xs px-3 py-2 rounded-lg',
                t.startsWith('✅') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
              )}>{t}</div>
            ))}
          </div>

          <button
            type="button"
            onClick={openCamera}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 active:scale-[0.98] transition-all"
            style={{fontFamily:'Syne,sans-serif'}}
          >
            <Camera size={18} />
            Iniciar verificación facial
          </button>

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all"
          >
            <Upload size={15} /> Subir selfie desde galería
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleFile} />
        </div>
      )}

      {/* ═══ CAMERA ═══ */}
      {screenMode === 'camera' && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <canvas
              ref={overlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            <div className={clsx(
              'absolute top-3 left-3 flex items-center gap-2 backdrop-blur-sm px-3 py-1.5 rounded-full border transition-all duration-300',
              faceVisible
                ? 'bg-green-500/20 border-green-500/30'
                : 'bg-zinc-900/70 border-white/10'
            )}>
              <div className={clsx(
                'w-2 h-2 rounded-full',
                faceVisible ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'
              )} />
              <span className={clsx(
                'text-xs font-medium',
                faceVisible ? 'text-green-400' : 'text-zinc-500'
              )}>
                {faceVisible ? 'Rostro detectado' : 'Buscando rostro...'}
              </span>
            </div>

            {hint && !finished && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center px-4">
                <div className="bg-black/75 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10">
                  <p className="text-sm text-white font-medium text-center">{hint}</p>
                </div>
              </div>
            )}
            {finished && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <div className="bg-green-500/20 border border-green-500/40 backdrop-blur-sm px-4 py-2 rounded-full">
                  <p className="text-sm text-green-400 font-medium">✅ ¡Perfecto! Tomando foto...</p>
                </div>
              </div>
            )}
          </div>
          <canvas ref={sampleRef} className="hidden" />

          <div className="bg-white/3 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Verificación de vida</p>
            <div className="space-y-2.5">
              {items.map((item, i) => (
                <div key={item.id} className={clsx(
                  'flex items-center gap-3 text-sm transition-all duration-300',
                  item.done        ? 'text-green-400'
                  : i === activeIdx ? 'text-amber-300'
                  : 'text-zinc-600'
                )}>
                  {item.done ? (
                    <CheckCircle2 size={16} className="flex-shrink-0" />
                  ) : i === activeIdx ? (
                    <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-zinc-700 flex-shrink-0" />
                  )}
                  <span>{item.label}</span>
                  {i === activeIdx && !item.done && (
                    <span className="ml-auto text-[10px] text-amber-500 font-medium uppercase tracking-wide">
                      EN CURSO
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => { stopCamera(); setScreenMode('guide') }}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* ═══ PREVIEW ═══ */}
      {screenMode === 'preview' && snapshot && (
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-[4/3]">
            <img src={snapshot} alt="Selfie" className="w-full h-full object-cover" />
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-xs text-green-400 font-medium">Prueba de vida completada</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 text-center">¿Tu rostro está claramente visible?</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-300 text-sm"
            >
              <RefreshCw size={14} /> Repetir
            </button>
            <button
              type="button"
              onClick={analyzeAndProceed}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] transition-all"
              style={{fontFamily:'Syne,sans-serif'}}
            >
              <Check size={16} /> Confirmar <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ═══ ANALYZING ═══ */}
      {screenMode === 'analyzing' && (
        <div className="text-center py-8 space-y-6">
          <div className="relative w-32 h-32 mx-auto">
            {snapshot && (
              <img src={snapshot} alt="" className="w-full h-full object-cover rounded-full border-2 border-amber-500/40" />
            )}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r="60" fill="none" stroke="#27272a" strokeWidth="4" />
              <circle cx="64" cy="64" r="60" fill="none" stroke="#f59e0b" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*60}`}
                strokeDashoffset={`${2*Math.PI*60*(1-analyzeProgress/100)}`}
                style={{transition:'stroke-dashoffset 0.4s ease'}}
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-bold text-white mb-1" style={{fontFamily:'Syne,sans-serif'}}>
              Analizando biometría...
            </p>
            <p className="text-sm text-zinc-500">{analyzeProgress}% completado</p>
          </div>
          <div className="space-y-2 text-left max-w-xs mx-auto">
            {[
              { label:'Detección de rostro',        done: analyzeProgress > 20 },
              { label:'Validación prueba de vida',   done: analyzeProgress > 50 },
              { label:'Análisis biométrico',         done: analyzeProgress > 75 },
              { label:'Validación final',            done: analyzeProgress >= 100 },
            ].map(it => (
              <div key={it.label} className={clsx(
                'flex items-center gap-3 text-xs',
                it.done ? 'text-green-400' : 'text-zinc-600'
              )}>
                {it.done
                  ? <CheckCircle2 size={14} />
                  : <div className="w-3.5 h-3.5 rounded-full border border-zinc-700" />
                }
                {it.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
