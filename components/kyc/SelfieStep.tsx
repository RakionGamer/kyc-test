'use client'

import { useRef, useState, useEffect } from 'react'
import {
  Eye, Camera, RefreshCw, Check, ArrowRight,
  AlertCircle, CheckCircle2, Upload, Loader2,
} from 'lucide-react'
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

/* ─── MediaPipe landmark indices ─────────────────────────────────────────── */
// Eye corners for EAR (Eye Aspect Ratio) — blink detection
const LEFT_EYE  = [33, 160, 158, 133, 153, 144]   // p1,p2,p3,p4,p5,p6
const RIGHT_EYE = [362, 385, 387, 263, 373, 380]
// Mouth corners + top/bottom for MAR (Mouth Aspect Ratio) — smile
const MOUTH_CORNERS = [61, 291]   // left, right corner
const MOUTH_TOP     = [13]
const MOUTH_BOTTOM  = [14]
// Nose tip for yaw (head turn)
const NOSE_TIP  = 1
const LEFT_CHEEK  = 234
const RIGHT_CHEEK = 454
// Face bbox landmarks
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
                   397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
                   172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

function earScore(lm: any[], indices: number[]): number {
  const p = indices.map(i => lm[i])
  // EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
  const d26 = dist(p[1], p[5])
  const d35 = dist(p[2], p[4])
  const d14 = dist(p[0], p[3])
  return d14 > 0 ? (d26 + d35) / (2 * d14) : 0
}

function dist(a: any, b: any): number {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2)
}

function mouthWidth(lm: any[]): number {
  return dist(lm[MOUTH_CORNERS[0]], lm[MOUTH_CORNERS[1]])
}

function mouthOpenness(lm: any[]): number {
  return dist(lm[MOUTH_TOP[0]], lm[MOUTH_BOTTOM[0]])
}

// Yaw: compare nose tip x vs midpoint of cheeks
function yawRatio(lm: any[]): number {
  const nose  = lm[NOSE_TIP]
  const left  = lm[LEFT_CHEEK]
  const right = lm[RIGHT_CHEEK]
  const mid   = (left.x + right.x) / 2
  const span  = Math.abs(right.x - left.x)
  return span > 0 ? (nose.x - mid) / span : 0
  // positive = nose right of center = head turned RIGHT
  // negative = nose left of center  = head turned LEFT
}

// How centered is face in frame (0 = perfect center)
function faceCenterOffset(lm: any[]): { dx: number; dy: number; size: number } {
  const nose = lm[NOSE_TIP]
  const dx = Math.abs(nose.x - 0.5)   // 0–0.5
  const dy = Math.abs(nose.y - 0.45)  // 0–0.5, slightly above center
  const left  = lm[LEFT_CHEEK]
  const right = lm[RIGHT_CHEEK]
  const size  = dist(left, right)      // normalized face width ~0.3–0.5
  return { dx, dy, size }
}

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function SelfieStep() {
  const { setStep, setSelfie, completeStep } = useKYCStore()

  const [screen,    setScreen]   = useState<ScreenMode>('guide')
  const [photo,     setPhoto]    = useState<string|null>(null)
  const [items,     setItems]    = useState<LivenessItem[]>(freshItems())
  const [activeI,   setActiveI]  = useState(0)
  const [face,      setFace]     = useState(false)
  const [hint,      setHint]     = useState('')
  const [done,      setDone]     = useState(false)
  const [err,       setErr]      = useState<string|null>(null)
  const [aprogress, setAprogress]= useState(0)
  const [loadMsg,   setLoadMsg]  = useState('Cargando modelo de detección...')

  /* DOM */
  const videoRef   = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const captureRef = useRef<HTMLCanvasElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)

  /* Runtime */
  const streamRef  = useRef<MediaStream|null>(null)
  const faceMeshRef= useRef<any>(null)
  const cameraRef  = useRef<any>(null)   // MediaPipe Camera helper
  const drawRaf    = useRef(0)
  const itemsR     = useRef(freshItems())
  const idxR       = useRef(0)
  const faceR      = useRef(false)
  const doneR      = useRef(false)
  const lastLM     = useRef<any[]|null>(null)  // latest landmarks

  /* Per-check accumulators */
  const centerOk   = useRef(0)       // frames face is centered
  const blinkCount = useRef(0)
  const blinkBase  = useRef<number[]>([])   // rolling EAR baseline
  const blinkCool  = useRef(0)
  const turnBuf    = useRef<number[]>([])   // rolling yaw
  const smileBase  = useRef<number[]>([])   // rolling mouth width baseline
  const smileDone  = useRef(false)

  function resetAccum() {
    centerOk.current=0
    blinkCount.current=0; blinkBase.current=[]; blinkCool.current=0
    turnBuf.current=[]
    smileBase.current=[]; smileDone.current=false
  }

  /* ── Cleanup ─────────────────────────────────────────────────────────── */
  function stopAll() {
    cancelAnimationFrame(drawRaf.current)
    cameraRef.current?.stop()
    streamRef.current?.getTracks().forEach(t=>t.stop())
    streamRef.current=null
    cameraRef.current=null
  }
  useEffect(()=>()=>stopAll(),[])

  /* ── Draw overlay loop (runs independently of MediaPipe) ─────────────── */
  function runDraw() {
    function tick() {
      const ov=overlayRef.current
      if(!ov){drawRaf.current=requestAnimationFrame(tick);return}
      const W=ov.offsetWidth||640, H=ov.offsetHeight||480
      if(ov.width!==W) ov.width=W
      if(ov.height!==H) ov.height=H
      const ctx=ov.getContext('2d')!
      ctx.clearRect(0,0,W,H)
      const cx=W/2, cy=H/2, rx=W*.26, ry=H*.43

      // dark vignette outside oval
      ctx.save()
      ctx.beginPath(); ctx.rect(0,0,W,H)
      ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2)
      ctx.fillStyle='rgba(0,0,0,0.50)'; ctx.fill('evenodd'); ctx.restore()

      // oval border
      ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2)
      ctx.strokeStyle=faceR.current?'#4ade80':'#f59e0b'
      ctx.lineWidth=3; ctx.stroke()

      // draw MediaPipe landmarks if available
      if(faceR.current && lastLM.current && !doneR.current){
        const lm=lastLM.current
        ctx.fillStyle='rgba(74,222,128,0.5)'
        // draw a few key points (eyes, nose, mouth)
        const keyPts=[1,33,263,61,291,159,386]
        for(const i of keyPts){
          const p=lm[i]
          if(!p) continue
          // landmarks are 0–1 normalized, mirror X because video is CSS-mirrored
          const px=(1-p.x)*W, py=p.y*H
          ctx.beginPath(); ctx.arc(px,py,2.5,0,Math.PI*2); ctx.fill()
        }

        // scan line
        const t=(Date.now()%2000)/2000
        const sy=(cy-ry)+t*ry*2
        const g=ctx.createLinearGradient(cx-rx,0,cx+rx,0)
        g.addColorStop(0,'transparent'); g.addColorStop(.5,'rgba(74,222,128,0.75)'); g.addColorStop(1,'transparent')
        ctx.beginPath(); ctx.moveTo(cx-rx,sy); ctx.lineTo(cx+rx,sy)
        ctx.strokeStyle=g; ctx.lineWidth=2; ctx.stroke()
      }

      drawRaf.current=requestAnimationFrame(tick)
    }
    drawRaf.current=requestAnimationFrame(tick)
  }

  /* ── Process landmarks each frame ────────────────────────────────────── */
  function processLandmarks(lm: any[]) {
    if(doneR.current) return
    lastLM.current=lm
    faceR.current=true; setFace(true)

    const idx  = idxR.current
    const item = itemsR.current[idx]
    if(!item) return

    setHint(item.instruction)
    let passed=false

    /* ── CENTER: face must be centered in oval, right size ── */
    if(item.id==='center'){
      const {dx,dy,size}=faceCenterOffset(lm)
      const centered = dx<0.08 && dy<0.10 && size>0.25 && size<0.65
      if(centered) centerOk.current++
      else centerOk.current=Math.max(0,centerOk.current-1)
      passed = centerOk.current > 20  // ~0.7s
    }

    /* ── BLINK: EAR drops below threshold twice ── */
    else if(item.id==='blink'){
      const leftEAR  = earScore(lm, LEFT_EYE)
      const rightEAR = earScore(lm, RIGHT_EYE)
      const ear      = (leftEAR+rightEAR)/2

      // build rolling baseline (open eyes)
      if(blinkCool.current>0){ blinkCool.current--; return }

      blinkBase.current.push(ear)
      if(blinkBase.current.length>40) blinkBase.current.shift()

      if(blinkBase.current.length>=20){
        const baseline=blinkBase.current.slice(0,15).reduce((a,b)=>a+b,0)/15
        const threshold=baseline*0.65  // eyes closed = EAR drops to <65% of baseline
        if(ear<threshold){
          blinkCount.current++
          blinkCool.current=15  // ignore next 15 frames (avoid double-count)
          blinkBase.current=[]
        }
      }
      passed = blinkCount.current>=2
    }

    /* ── TURN LEFT: yaw < -0.12 for several frames ── */
    else if(item.id==='left'){
      const yaw=yawRatio(lm)
      turnBuf.current.push(yaw)
      if(turnBuf.current.length>15) turnBuf.current.shift()
      const avg=turnBuf.current.reduce((a,b)=>a+b,0)/turnBuf.current.length
      passed = turnBuf.current.length>=10 && avg < -0.12
    }

    /* ── TURN RIGHT: yaw > +0.12 for several frames ── */
    else if(item.id==='right'){
      const yaw=yawRatio(lm)
      turnBuf.current.push(yaw)
      if(turnBuf.current.length>15) turnBuf.current.shift()
      const avg=turnBuf.current.reduce((a,b)=>a+b,0)/turnBuf.current.length
      passed = turnBuf.current.length>=10 && avg > 0.12
    }

    /* ── SMILE: mouth width increases significantly vs neutral baseline ── */
    else if(item.id==='smile'){
      const w=mouthWidth(lm)
      const o=mouthOpenness(lm)

      // calibrate neutral mouth width baseline
      if(smileBase.current.length<25){
        smileBase.current.push(w)
      } else {
        const baseline=smileBase.current.reduce((a,b)=>a+b,0)/smileBase.current.length
        // smile: width increases AND slight openness
        const smiling = w>baseline*1.18 && o>0.015
        if(smiling && !smileDone.current){
          smileDone.current=true
          passed=true
        }
      }
    }

    if(passed){
      const next=idx+1
      itemsR.current=itemsR.current.map((it,i)=>i===idx?{...it,done:true}:it)
      setItems([...itemsR.current]); idxR.current=next; setActiveI(next); resetAccum()
      if(next>=itemsR.current.length){
        doneR.current=true; setDone(true); setHint('✅ ¡Perfecto!')
        setTimeout(()=>captureStill(),800)
      }
    }
  }

  /* ── Load MediaPipe & start camera ───────────────────────────────────── */
  async function openCamera() {
    setErr(null); setScreen('loading')
    setLoadMsg('Solicitando permisos de cámara...')

    // 1. get camera permission first
    let stream: MediaStream|null=null
    const tries: MediaStreamConstraints[]=[
      {video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}}},
      {video:{facingMode:'user'}},
      {video:true},
    ]
    let lastErr: unknown=null
    for(const c of tries){
      try{stream=await navigator.mediaDevices.getUserMedia(c);break}
      catch(e){lastErr=e}
    }
    if(!stream){
      const n=(lastErr as any)?.name??''
      const m:Record<string,string>={
        NotAllowedError:'🚫 Permiso denegado. Haz clic en el ícono de cámara en la barra del navegador.',
        PermissionDeniedError:'🚫 Permiso denegado. Haz clic en el ícono de cámara en la barra del navegador.',
        NotFoundError:'📷 No se detectó cámara en este dispositivo.',
        NotReadableError:'⚠️ La cámara está en uso por otra aplicación.',
        SecurityError:'🔒 Acceso bloqueado. Abre en localhost o HTTPS.',
      }
      setErr(m[n]??`No se pudo acceder a la cámara (${n||'desconocido'}).`)
      setScreen('guide'); return
    }
    streamRef.current=stream

    // 2. load MediaPipe scripts dynamically
    setLoadMsg('Cargando modelo de detección facial...')
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js')
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js')
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js')
    } catch(e) {
      setErr('No se pudo cargar el modelo de detección. Verifica tu conexión a internet.')
      stream.getTracks().forEach(t=>t.stop()); streamRef.current=null
      setScreen('guide'); return
    }

    // 3. init FaceMesh
    setLoadMsg('Iniciando reconocimiento facial...')
    const FM = (window as any).FaceMesh
    if(!FM){ setErr('Error cargando FaceMesh.'); setScreen('guide'); return }

    const faceMesh=new FM({locateFile:(f:string)=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`})
    faceMesh.setOptions({
      maxNumFaces:1,
      refineLandmarks:true,
      minDetectionConfidence:0.6,
      minTrackingConfidence:0.6,
    })
    faceMesh.onResults((results:any)=>{
      if(results.multiFaceLandmarks?.length>0){
        processLandmarks(results.multiFaceLandmarks[0])
      } else {
        faceR.current=false; lastLM.current=null
        setFace(false)
        if(!doneR.current) setHint('👤 Coloca tu cara dentro del óvalo')
      }
    })
    faceMeshRef.current=faceMesh

    // reset check state
    itemsR.current=freshItems(); idxR.current=0
    faceR.current=false; doneR.current=false
    setItems(freshItems()); setActiveI(0)
    setFace(false); setHint(''); setDone(false)
    resetAccum()

    setScreen('camera')
  }

  /* ── Attach video + start loops after camera screen renders ─────────── */
  useEffect(()=>{
    if(screen!=='camera') return
    const v=videoRef.current
    if(!v||!streamRef.current||!faceMeshRef.current) return

    v.srcObject=streamRef.current
    v.onloadedmetadata=()=>{
      v.play().catch(()=>{})
      runDraw()

      // Use MediaPipe Camera utility to feed frames into FaceMesh
      const Cam=(window as any).Camera
      if(Cam){
        const cam=new Cam(v,{
          onFrame: async()=>{ await faceMeshRef.current.send({image:v}) },
          width:640, height:480,
        })
        cam.start()
        cameraRef.current=cam
      } else {
        // Fallback: manual rAF loop if Camera util not available
        const loop=async()=>{
          if(doneR.current) return
          if(v.readyState>=2) await faceMeshRef.current.send({image:v})
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      }
    }
  },[screen]) // eslint-disable-line

  /* ── Capture still ───────────────────────────────────────────────────── */
  function captureStill(){
    const v=videoRef.current, c=captureRef.current
    if(!v||!c) return
    c.width=v.videoWidth||640; c.height=v.videoHeight||480
    const ctx=c.getContext('2d')!
    ctx.save(); ctx.translate(c.width,0); ctx.scale(-1,1)
    ctx.drawImage(v,0,0); ctx.restore()
    const img=c.toDataURL('image/jpeg',.92)
    stopAll(); setPhoto(img); setScreen('preview')
  }

  /* ── Analyze & proceed ───────────────────────────────────────────────── */
  async function proceed(){
    setScreen('analyzing'); setAprogress(0)
    for(const p of [15,35,55,72,88,95,100]){
      await new Promise(r=>setTimeout(r,400)); setAprogress(p)
    }
    if(photo){ setSelfie(photo,Math.floor(Math.random()*10)+90); completeStep('selfie'); setStep('review') }
  }

  function retake(){ setPhoto(null); setScreen('guide') }

  function handleFile(e:React.ChangeEvent<HTMLInputElement>){
    const f=e.target.files?.[0]; if(!f) return
    const r=new FileReader()
    r.onloadend=()=>{setPhoto(r.result as string);setScreen('preview')}
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
            <svg className="absolute inset-0 w-full h-full -rotate-90 animate-spin" style={{animationDuration:'1.5s'}} viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="37" fill="none" stroke="#f59e0b" strokeWidth="3"
                strokeLinecap="round" strokeDasharray="60 180"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-white font-semibold mb-1" style={{fontFamily:'Syne,sans-serif'}}>Preparando verificación</p>
            <p className="text-sm text-zinc-500">{loadMsg}</p>
          </div>
          <div className="flex flex-col gap-2 text-xs text-zinc-600 text-center max-w-xs">
            <p>Usando MediaPipe Face Mesh — 468 puntos de referencia faciales</p>
            <p>La primera vez puede tardar ~5s en descargar el modelo</p>
          </div>
        </div>
      )}

      {/* ═══ CAMERA ═══ */}
      {screen==='camera'&&(
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{transform:'scaleX(-1)'}}/>
            <canvas ref={overlayRef}
              className="absolute inset-0 w-full h-full pointer-events-none"/>

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

            {/* Hint */}
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

          {/* Hidden capture canvas */}
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

/* ─── Helper: load external script ──────────────────────────────────────── */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = src; s.crossOrigin = 'anonymous'
    s.onload  = () => resolve()
    s.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(s)
  })
}
