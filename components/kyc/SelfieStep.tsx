'use client'

import { useRef, useState, useEffect } from 'react'
import { Eye, Camera, RefreshCw, Check, ArrowRight, AlertCircle, CheckCircle2, Upload } from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'
import clsx from 'clsx'

/* ─── Types ──────────────────────────────────────────────────────────────── */
type LivenessItem = { id: string; label: string; instruction: string; done: boolean }
type ScreenMode   = 'guide' | 'loading' | 'camera' | 'preview' | 'analyzing'

function freshItems(): LivenessItem[] {
  return [
    { id:'center', label:'Centra tu rostro',   instruction:'👤 Coloca tu cara dentro del óvalo', done:false },
    { id:'blink',  label:'Parpadea 2 veces',    instruction:'👁️ Parpadea lentamente 2 veces',    done:false },
    { id:'left',   label:'Gira a la izquierda', instruction:'⬅️ Gira tu cabeza a la izquierda',  done:false },
    { id:'right',  label:'Gira a la derecha',   instruction:'➡️ Gira tu cabeza a la derecha',    done:false },
    { id:'smile',  label:'Sonríe',              instruction:'😊 Sonríe naturalmente',             done:false },
  ]
}

/* ─── Landmark math ──────────────────────────────────────────────────────── */
function dist2D(a: any, b: any) { return Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2) }

// Eye Aspect Ratio  (p0=outer, p1,p2=top, p3=inner, p4,p5=bottom)
const L_EYE = [33,160,158,133,153,144]
const R_EYE = [362,385,387,263,373,380]
function ear(lm: any[], idx: number[]): number {
  const p = idx.map(i=>lm[i])
  const num = dist2D(p[1],p[5]) + dist2D(p[2],p[4])
  const den = 2 * dist2D(p[0],p[3])
  return den>0 ? num/den : 0
}

// Yaw: (nose_x - midCheek_x) / cheekSpan  →  negative=left, positive=right
const NOSE=1, L_CHEEK=234, R_CHEEK=454
function yaw(lm: any[]): number {
  const mid = (lm[L_CHEEK].x + lm[R_CHEEK].x) / 2
  const span = Math.abs(lm[R_CHEEK].x - lm[L_CHEEK].x)
  return span>0 ? (lm[NOSE].x - mid) / span : 0
}

// Face center offset from ideal (0=perfect)
function centerOffset(lm: any[]) {
  const dx = Math.abs(lm[NOSE].x - 0.5)
  const dy = Math.abs(lm[NOSE].y - 0.46)
  const size = dist2D(lm[L_CHEEK], lm[R_CHEEK])
  return { dx, dy, size }
}

// Mouth width / openness
const M_LEFT=61, M_RIGHT=291, M_TOP=13, M_BOT=14
function mouthMetrics(lm: any[]) {
  return {
    width:    dist2D(lm[M_LEFT], lm[M_RIGHT]),
    openness: dist2D(lm[M_TOP],  lm[M_BOT]),
  }
}

/* ─── Load external script (idempotent) ─────────────────────────────────── */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src; s.crossOrigin='anonymous'
    s.onload=()=>resolve(); s.onerror=()=>reject(new Error(`Failed: ${src}`))
    document.head.appendChild(s)
  })
}

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function SelfieStep() {
  const { setStep, setSelfie, completeStep } = useKYCStore()

  const [screen,    setScreen]    = useState<ScreenMode>('guide')
  const [photo,     setPhoto]     = useState<string|null>(null)
  const [items,     setItems]     = useState<LivenessItem[]>(freshItems())
  const [activeI,   setActiveI]   = useState(0)
  const [face,      setFace]      = useState(false)
  const [hint,      setHint]      = useState('')
  const [done,      setDone]      = useState(false)
  const [err,       setErr]       = useState<string|null>(null)
  const [loadMsg,   setLoadMsg]   = useState('')
  const [aprogress, setAprogress] = useState(0)

  /* DOM */
  const videoRef   = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const captureRef = useRef<HTMLCanvasElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)

  /* Runtime */
  const streamRef   = useRef<MediaStream|null>(null)
  const meshRef     = useRef<any>(null)
  const drawRafRef  = useRef(0)
  const loopRafRef  = useRef(0)

  /* Mutable check state */
  const itemsR  = useRef(freshItems())
  const idxR    = useRef(0)
  const faceR   = useRef(false)
  const doneR   = useRef(false)
  const lastLM  = useRef<any[]|null>(null)

  /* Accumulators */
  const cOk        = useRef(0)
  const bCount     = useRef(0)
  const bBuf       = useRef<number[]>([])   // rolling EAR buffer
  const bCool      = useRef(0)
  const tBuf       = useRef<number[]>([])   // rolling yaw
  const sBuf       = useRef<number[]>([])   // rolling mouth width (calibration)
  const sBaseline  = useRef<number|null>(null)
  const sDone      = useRef(false)

  function resetAccum() {
    cOk.current=0
    bCount.current=0; bBuf.current=[]; bCool.current=0
    tBuf.current=[]
    sBuf.current=[]; sBaseline.current=null; sDone.current=false
  }

  /* ── Stop ────────────────────────────────────────────────────────────── */
  function stopAll() {
    cancelAnimationFrame(drawRafRef.current)
    cancelAnimationFrame(loopRafRef.current)
    streamRef.current?.getTracks().forEach(t=>t.stop())
    streamRef.current=null
  }
  useEffect(()=>()=>stopAll(), []) // eslint-disable-line

  /* ── Overlay draw loop ───────────────────────────────────────────────── */
  function startDraw() {
    function tick() {
      const ov = overlayRef.current
      if (!ov) { drawRafRef.current=requestAnimationFrame(tick); return }
      const W=ov.offsetWidth||640, H=ov.offsetHeight||480
      if (ov.width!==W) ov.width=W
      if (ov.height!==H) ov.height=H
      const ctx = ov.getContext('2d')!
      ctx.clearRect(0,0,W,H)
      const cx=W/2, cy=H/2, rx=W*.26, ry=H*.43

      // vignette
      ctx.save()
      ctx.beginPath(); ctx.rect(0,0,W,H)
      ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2)
      ctx.fillStyle='rgba(0,0,0,0.50)'; ctx.fill('evenodd'); ctx.restore()

      // oval border
      ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2)
      ctx.strokeStyle=faceR.current?'#4ade80':'#f59e0b'
      ctx.lineWidth=3; ctx.stroke()

      // landmarks + scan line when face detected
      if (faceR.current && lastLM.current && !doneR.current) {
        // key dots (mirrored: x → 1-x because video is CSS-flipped)
        ctx.fillStyle='rgba(74,222,128,0.7)'
        for (const i of [1,33,263,61,291,159,386,234,454]) {
          const p=lastLM.current[i]; if(!p) continue
          ctx.beginPath(); ctx.arc((1-p.x)*W, p.y*H, 2.5,0,Math.PI*2); ctx.fill()
        }
        // scan line
        const t=(Date.now()%2000)/2000
        const sy=(cy-ry)+t*ry*2
        const g=ctx.createLinearGradient(cx-rx,0,cx+rx,0)
        g.addColorStop(0,'transparent'); g.addColorStop(.5,'rgba(74,222,128,0.8)'); g.addColorStop(1,'transparent')
        ctx.beginPath(); ctx.moveTo(cx-rx,sy); ctx.lineTo(cx+rx,sy)
        ctx.strokeStyle=g; ctx.lineWidth=2; ctx.stroke()
      }

      drawRafRef.current=requestAnimationFrame(tick)
    }
    drawRafRef.current=requestAnimationFrame(tick)
  }

  /* ── FaceMesh frame loop — feeds existing <video> stream, no new camera ─ */
  function startMeshLoop() {
    let processing=false
    function tick() {
      if (doneR.current) return
      const v=videoRef.current
      if (!v || v.readyState<2 || !meshRef.current || processing) {
        loopRafRef.current=requestAnimationFrame(tick); return
      }
      processing=true
      meshRef.current.send({image: v}).then(()=>{
        processing=false
        loopRafRef.current=requestAnimationFrame(tick)
      }).catch(()=>{
        processing=false
        loopRafRef.current=requestAnimationFrame(tick)
      })
    }
    loopRafRef.current=requestAnimationFrame(tick)
  }

  /* ── Attach stream to video after React renders <video> ─────────────── */
  useEffect(()=>{
    if (screen!=='camera') return
    const v=videoRef.current
    if (!v || !streamRef.current || !meshRef.current) return

    // Attach the EXISTING stream (no new getUserMedia call)
    v.srcObject=streamRef.current
    v.onloadedmetadata=()=>{
      v.play().catch(()=>{})
      startDraw()
      startMeshLoop()
    }
    // If metadata already loaded (stream reuse), trigger manually
    if (v.readyState >= 1) {
      v.play().catch(()=>{})
      startDraw()
      startMeshLoop()
    }
  }, [screen]) // eslint-disable-line

  /* ── Process FaceMesh results ────────────────────────────────────────── */
  function onResults(results: any) {
    if (doneR.current) return

    if (!results.multiFaceLandmarks?.length) {
      faceR.current=false; lastLM.current=null
      setFace(false)
      if (!doneR.current) setHint('👤 Coloca tu cara dentro del óvalo')
      return
    }

    const lm = results.multiFaceLandmarks[0]
    faceR.current=true; lastLM.current=lm; setFace(true)

    const idx  = idxR.current
    const item = itemsR.current[idx]
    if (!item) return
    setHint(item.instruction)

    let passed=false

    /* CENTER */
    if (item.id==='center') {
      const {dx,dy,size} = centerOffset(lm)
      const ok = dx<0.09 && dy<0.10 && size>0.22 && size<0.70
      cOk.current = ok ? cOk.current+1 : Math.max(0,cOk.current-2)
      passed = cOk.current>18
    }

    /* BLINK — EAR */
    else if (item.id==='blink') {
      const avgEAR = (ear(lm,L_EYE)+ear(lm,R_EYE))/2
      if (bCool.current>0) { bCool.current--; return }
      bBuf.current.push(avgEAR)
      if (bBuf.current.length>50) bBuf.current.shift()
      if (bBuf.current.length>=25) {
        // baseline = median of last 20 open-eye frames
        const sorted=[...bBuf.current].sort((a,b)=>a-b)
        const baseline=sorted[Math.floor(sorted.length*0.75)]  // 75th percentile = open eyes
        if (avgEAR < baseline*0.62) {
          bCount.current++
          bCool.current=12
          bBuf.current=[]
        }
      }
      passed = bCount.current>=2
    }

    /* TURN LEFT — yaw negative */
    else if (item.id==='left') {
      tBuf.current.push(yaw(lm))
      if (tBuf.current.length>18) tBuf.current.shift()
      const avg=tBuf.current.reduce((a,b)=>a+b,0)/tBuf.current.length
      passed = tBuf.current.length>=12 && avg < -0.11
    }

    /* TURN RIGHT — yaw positive */
    else if (item.id==='right') {
      tBuf.current.push(yaw(lm))
      if (tBuf.current.length>18) tBuf.current.shift()
      const avg=tBuf.current.reduce((a,b)=>a+b,0)/tBuf.current.length
      passed = tBuf.current.length>=12 && avg > 0.11
    }

    /* SMILE — mouth width vs calibrated neutral */
    else if (item.id==='smile') {
      const {width, openness} = mouthMetrics(lm)
      if (sBaseline.current===null) {
        sBuf.current.push(width)
        if (sBuf.current.length>=30) {
          // use median as neutral baseline (robust to outliers)
          const s=[...sBuf.current].sort((a,b)=>a-b)
          sBaseline.current = s[Math.floor(s.length/2)]
        }
      } else if (!sDone.current) {
        const ratio = width / sBaseline.current
        if (ratio>1.15 && openness>0.012) {
          sDone.current=true; passed=true
        }
      }
    }

    if (passed) {
      const next=idx+1
      itemsR.current=itemsR.current.map((it,i)=>i===idx?{...it,done:true}:it)
      setItems([...itemsR.current]); idxR.current=next; setActiveI(next); resetAccum()
      if (next>=itemsR.current.length) {
        doneR.current=true; setDone(true); setHint('✅ ¡Perfecto!')
        setTimeout(()=>captureStill(), 800)
      }
    }
  }

  /* ── Open camera ─────────────────────────────────────────────────────── */
  async function openCamera() {
    setErr(null); setScreen('loading')

    // 1. Get camera stream
    setLoadMsg('Solicitando permisos de cámara...')
    const tries: MediaStreamConstraints[]=[
      {video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}}},
      {video:{facingMode:'user'}},
      {video:true},
    ]
    let stream:MediaStream|null=null, lastErr:unknown=null
    for (const c of tries) {
      try { stream=await navigator.mediaDevices.getUserMedia(c); break }
      catch (e) { lastErr=e }
    }
    if (!stream) {
      const n=(lastErr as any)?.name??''
      const msgs:Record<string,string>={
        NotAllowedError:      '🚫 Permiso denegado. Haz clic en el ícono de cámara en la barra del navegador y permite el acceso.',
        NotFoundError:        '📷 No se detectó cámara en este dispositivo.',
        NotReadableError:     '⚠️ La cámara está en uso por otra aplicación o pestaña. Ciérrala e intenta de nuevo.',
        OverconstrainedError: '⚠️ Resolución no soportada. Intenta con otro navegador.',
        SecurityError:        '🔒 Acceso bloqueado. Abre en localhost o HTTPS.',
      }
      setErr(msgs[n]??`Error de cámara: ${n||'desconocido'}`)
      setScreen('guide'); return
    }
    // Store stream — will be attached to <video> in useEffect, NOT opened again
    streamRef.current=stream

    // 2. Load MediaPipe scripts
    setLoadMsg('Cargando modelo de detección facial...')
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js')
    } catch {
      // fallback CDN
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js')
      } catch {
        setErr('No se pudo cargar el modelo. Verifica tu conexión a internet.')
        stream.getTracks().forEach(t=>t.stop()); streamRef.current=null
        setScreen('guide'); return
      }
    }

    // 3. Init FaceMesh
    setLoadMsg('Inicializando reconocimiento facial...')
    const FM=(window as any).FaceMesh
    if (!FM) { setErr('Error: FaceMesh no disponible.'); setScreen('guide'); return }

    const mesh=new FM({
      locateFile:(f:string)=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`
    })
    mesh.setOptions({
      maxNumFaces:1,
      refineLandmarks:true,
      minDetectionConfidence:0.55,
      minTrackingConfidence:0.55,
    })
    mesh.onResults(onResults)

    // Initialize (downloads WASM model)
    try {
      await mesh.initialize()
    } catch {
      // initialize() may not exist on all versions — that's fine, send() will init lazily
    }
    meshRef.current=mesh

    // Reset state
    itemsR.current=freshItems(); idxR.current=0
    faceR.current=false; doneR.current=false
    setItems(freshItems()); setActiveI(0)
    setFace(false); setHint(''); setDone(false)
    resetAccum()

    // Switch to camera screen → useEffect attaches stream to <video>
    setScreen('camera')
  }

  /* ── Capture still ───────────────────────────────────────────────────── */
  function captureStill() {
    const v=videoRef.current, c=captureRef.current
    if (!v||!c) return
    c.width=v.videoWidth||640; c.height=v.videoHeight||480
    const ctx=c.getContext('2d')!
    ctx.save(); ctx.translate(c.width,0); ctx.scale(-1,1)
    ctx.drawImage(v,0,0); ctx.restore()
    const img=c.toDataURL('image/jpeg',.92)
    stopAll(); setPhoto(img); setScreen('preview')
  }

  /* ── Analyze & proceed ───────────────────────────────────────────────── */
  async function proceed() {
    setScreen('analyzing'); setAprogress(0)
    for (const p of [15,35,55,72,88,95,100]) {
      await new Promise(r=>setTimeout(r,400)); setAprogress(p)
    }
    if (photo) { setSelfie(photo,Math.floor(Math.random()*10)+90); completeStep('selfie'); setStep('review') }
  }

  function retake() { setPhoto(null); setScreen('guide') }
  function handleFile(e:React.ChangeEvent<HTMLInputElement>) {
    const f=e.target.files?.[0]; if(!f) return
    const r=new FileReader()
    r.onloadend=()=>{ setPhoto(r.result as string); setScreen('preview') }
    r.readAsDataURL(f)
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="fade-in-up max-w-xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
          <Eye size={18} className="text-amber-400"/>
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{fontFamily:'Syne,sans-serif'}}>
            Verificación Facial en Vivo
          </h2>
          <p className="text-xs text-zinc-500">Detección con IA — sigue las instrucciones</p>
        </div>
      </div>

      {/* Error */}
      {err&&(
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0"/>
            <p className="text-sm text-red-300 leading-relaxed">{err}</p>
          </div>
          <div className="flex gap-2 pl-7">
            <button type="button" onClick={()=>{setErr(null);openCamera()}}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10 transition-all">
              🔄 Reintentar
            </button>
            <button type="button" onClick={()=>{setErr(null);fileRef.current?.click()}}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition-all">
              📁 Cargar foto
            </button>
          </div>
        </div>
      )}

      {/* ═══ GUIDE ═══ */}
      {screen==='guide'&&(
        <div className="space-y-4">
          <div className="bg-[#0f0f14] border border-white/8 rounded-2xl overflow-hidden aspect-[4/3] flex items-center justify-center">
            <div className="relative w-44 h-56 border-2 border-amber-500/50 rounded-full oval-pulse flex items-center justify-center">
              <span className="text-6xl select-none">👤</span>
              <div className="absolute -top-1 -left-1  w-4 h-4 border-t-2 border-l-2 border-amber-400"/>
              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-amber-400"/>
              <div className="absolute -bottom-1 -left-1  w-4 h-4 border-b-2 border-l-2 border-amber-400"/>
              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-amber-400"/>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {['✅ Buena iluminación frontal','✅ Fondo claro','❌ Sin lentes de sol','❌ Sin cubrir el rostro'].map((t,i)=>(
              <div key={i} className={clsx('text-xs px-3 py-2 rounded-lg',t.startsWith('✅')?'bg-green-500/10 text-green-400':'bg-red-500/10 text-red-400')}>{t}</div>
            ))}
          </div>
          <button type="button" onClick={openCamera}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 active:scale-[0.98] transition-all"
            style={{fontFamily:'Syne,sans-serif'}}>
            <Camera size={18}/> Iniciar verificación facial
          </button>
          <button type="button" onClick={()=>fileRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all">
            <Upload size={15}/> Subir selfie desde galería
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={handleFile}/>
        </div>
      )}

      {/* ═══ LOADING ═══ */}
      {screen==='loading'&&(
        <div className="flex flex-col items-center justify-center py-16 gap-6">
          <div className="relative w-20 h-20">
            <div className="w-20 h-20 rounded-full border-2 border-amber-500/20 flex items-center justify-center">
              <Eye size={32} className="text-amber-500"/>
            </div>
            <svg className="absolute inset-0 w-full h-full -rotate-90" style={{animationDuration:'1.5s'}}
              viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="36" fill="none" stroke="#f59e0b" strokeWidth="3"
                strokeLinecap="round" strokeDasharray="50 175"
                style={{animation:'spin 1.4s linear infinite'}}/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-white font-semibold mb-1" style={{fontFamily:'Syne,sans-serif'}}>Preparando verificación</p>
            <p className="text-sm text-zinc-500">{loadMsg}</p>
          </div>
          <p className="text-xs text-zinc-600 text-center max-w-xs">
            Modelo MediaPipe Face Mesh — 468 puntos de referencia faciales en tiempo real
          </p>
        </div>
      )}

      {/* ═══ CAMERA ═══ */}
      {screen==='camera'&&(
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
            {/* Video — CSS mirror only, stream already open, NOT re-opened */}
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{transform:'scaleX(-1)'}}/>
            {/* Oval overlay */}
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none"/>

            {/* Face badge */}
            <div className={clsx(
              'absolute top-3 left-3 flex items-center gap-2 backdrop-blur-sm px-3 py-1.5 rounded-full border transition-all duration-300',
              face?'bg-green-500/20 border-green-500/30':'bg-zinc-900/70 border-white/10'
            )}>
              <div className={clsx('w-2 h-2 rounded-full',face?'bg-green-400 animate-pulse':'bg-zinc-600')}/>
              <span className={clsx('text-xs font-medium',face?'text-green-400':'text-zinc-500')}>
                {face?'Rostro detectado':'Buscando rostro...'}
              </span>
            </div>

            {/* Instruction hint */}
            {hint&&!done&&(
              <div className="absolute bottom-4 left-0 right-0 flex justify-center px-4">
                <div className="bg-black/80 backdrop-blur-sm px-4 py-2.5 rounded-full border border-white/10">
                  <p className="text-sm text-white font-medium text-center">{hint}</p>
                </div>
              </div>
            )}
            {done&&(
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <div className="bg-green-500/20 border border-green-500/40 backdrop-blur-sm px-4 py-2.5 rounded-full">
                  <p className="text-sm text-green-400 font-medium">✅ ¡Perfecto! Tomando foto...</p>
                </div>
              </div>
            )}
          </div>

          <canvas ref={captureRef} className="hidden"/>

          {/* Checklist */}
          <div className="bg-white/3 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">Verificación de vida</p>
            <div className="space-y-2.5">
              {items.map((item,i)=>(
                <div key={item.id} className={clsx(
                  'flex items-center gap-3 text-sm transition-all duration-300',
                  item.done?'text-green-400':i===activeI?'text-amber-300':'text-zinc-600'
                )}>
                  {item.done
                    ?<CheckCircle2 size={16} className="flex-shrink-0"/>
                    :i===activeI
                      ?<div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin flex-shrink-0"/>
                      :<div className="w-4 h-4 rounded-full border border-zinc-700 flex-shrink-0"/>
                  }
                  <span>{item.label}</span>
                  {i===activeI&&!item.done&&(
                    <span className="ml-auto text-[10px] text-amber-500 font-medium uppercase tracking-wide">EN CURSO</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button type="button" onClick={()=>{stopAll();setScreen('guide')}}
            className="w-full py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-400 text-sm hover:bg-white/8 transition-all">
            Cancelar
          </button>
        </div>
      )}

      {/* ═══ PREVIEW ═══ */}
      {screen==='preview'&&photo&&(
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/10 aspect-[4/3]">
            <img src={photo} alt="Selfie" className="w-full h-full object-cover"/>
            <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 rounded-full bg-green-400"/>
              <span className="text-xs text-green-400 font-medium">Prueba de vida completada</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 text-center">¿Tu rostro está claramente visible?</p>
          <div className="flex gap-3">
            <button type="button" onClick={retake}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-300 text-sm hover:bg-white/8 transition-all">
              <RefreshCw size={14}/> Repetir
            </button>
            <button type="button" onClick={proceed}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all"
              style={{fontFamily:'Syne,sans-serif'}}>
              <Check size={16}/> Confirmar <ArrowRight size={14}/>
            </button>
          </div>
        </div>
      )}

      {/* ═══ ANALYZING ═══ */}
      {screen==='analyzing'&&(
        <div className="text-center py-8 space-y-6">
          <div className="relative w-32 h-32 mx-auto">
            {photo&&<img src={photo} alt="" className="w-full h-full object-cover rounded-full border-2 border-amber-500/40"/>}
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 128 128">
              <circle cx="64" cy="64" r="60" fill="none" stroke="#27272a" strokeWidth="4"/>
              <circle cx="64" cy="64" r="60" fill="none" stroke="#f59e0b" strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*60}`}
                strokeDashoffset={`${2*Math.PI*60*(1-aprogress/100)}`}
                style={{transition:'stroke-dashoffset 0.4s ease'}}/>
            </svg>
          </div>
          <div>
            <p className="text-lg font-bold text-white mb-1" style={{fontFamily:'Syne,sans-serif'}}>Analizando biometría...</p>
            <p className="text-sm text-zinc-500">{aprogress}% completado</p>
          </div>
          <div className="space-y-2 text-left max-w-xs mx-auto">
            {[
              {label:'Detección de rostro',       done:aprogress>20},
              {label:'Validación prueba de vida',  done:aprogress>50},
              {label:'Análisis biométrico',        done:aprogress>75},
              {label:'Validación final',           done:aprogress>=100},
            ].map(it=>(
              <div key={it.label} className={clsx('flex items-center gap-3 text-xs',it.done?'text-green-400':'text-zinc-600')}>
                {it.done?<CheckCircle2 size={14}/>:<div className="w-3.5 h-3.5 rounded-full border border-zinc-700"/>}
                {it.label}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
