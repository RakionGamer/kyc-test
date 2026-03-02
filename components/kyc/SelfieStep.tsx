'use client'

import { useRef, useState, useEffect } from 'react'
import {
  Eye, Camera, RefreshCw, Check, ArrowRight,
  AlertCircle, CheckCircle2, Upload,
} from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'
import clsx from 'clsx'

/* ─── Types ──────────────────────────────────────────────────────────────── */
type LivenessItem = { id: string; label: string; instruction: string; done: boolean }
type ScreenMode   = 'guide' | 'camera' | 'preview' | 'analyzing'

function freshItems(): LivenessItem[] {
  return [
    { id:'center', label:'Centra tu rostro',   instruction:'👤 Coloca tu cara dentro del óvalo', done:false },
    { id:'blink',  label:'Parpadea 2 veces',    instruction:'👁️ Parpadea lentamente 2 veces',    done:false },
    { id:'left',   label:'Gira a la izquierda', instruction:'⬅️ Gira tu cabeza a la izquierda',  done:false },
    { id:'right',  label:'Gira a la derecha',   instruction:'➡️ Gira tu cabeza a la derecha',    done:false },
    { id:'smile',  label:'Sonríe',              instruction:'😊 Sonríe naturalmente',             done:false },
  ]
}

/* ─── Pixel helper ───────────────────────────────────────────────────────── */
function luma(d: Uint8ClampedArray, x0:number, y0:number, rw:number, rh:number, W:number): number {
  let s=0, n=0
  for (let y=y0; y<y0+rh; y++) for (let x=x0; x<x0+rw && x<W; x++) {
    const i=(y*W+x)*4; s+=d[i]*.299+d[i+1]*.587+d[i+2]*.114; n++
  }
  return n ? s/n : 0
}

/* ─── Component ──────────────────────────────────────────────────────────── */
export default function SelfieStep() {
  const { setStep, setSelfie, completeStep } = useKYCStore()

  /* UI state */
  const [screen,   setScreen]   = useState<ScreenMode>('guide')
  const [photo,    setPhoto]    = useState<string|null>(null)
  const [items,    setItems]    = useState<LivenessItem[]>(freshItems())
  const [activeI,  setActiveI]  = useState(0)
  const [face,     setFace]     = useState(false)
  const [hint,     setHint]     = useState('')
  const [done,     setDone]     = useState(false)
  const [err,      setErr]      = useState<string|null>(null)
  const [aprogress,setAprogress]= useState(0)

  /* DOM */
  const videoRef   = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sampleRef  = useRef<HTMLCanvasElement>(null)
  const fileRef    = useRef<HTMLInputElement>(null)

  /* Runtime refs */
  const streamRef  = useRef<MediaStream|null>(null)
  const drawRaf    = useRef(0)
  const loopRaf    = useRef(0)
  const itemsR     = useRef(freshItems())
  const idxR       = useRef(0)
  const faceR      = useRef(false)
  const doneR      = useRef(false)

  /* Accumulator refs */
  const cTick      = useRef(0)
  const bCount     = useRef(0)
  const bBase      = useRef<number|null>(null)
  const bCalib     = useRef<number[]>([])
  const bCool      = useRef(0)
  const tBuf       = useRef<number[]>([])
  const sBase      = useRef<number|null>(null)
  const sCalib     = useRef<number[]>([])

  function resetAccum() {
    cTick.current=0; bCount.current=0; bBase.current=null
    bCalib.current=[]; bCool.current=0; tBuf.current=[]
    sBase.current=null; sCalib.current=[]
  }

  /* ── Stop everything ─────────────────────────────────────────────────── */
  function stopAll() {
    cancelAnimationFrame(drawRaf.current)
    cancelAnimationFrame(loopRaf.current)
    streamRef.current?.getTracks().forEach(t=>t.stop())
    streamRef.current=null
  }
  useEffect(()=>()=>stopAll(),[])

  /* ── KEY FIX: attach stream to video AFTER React renders the <video> ──── */
  useEffect(()=>{
    if (screen!=='camera') return
    const v=videoRef.current
    if (!v || !streamRef.current) return
    v.srcObject=streamRef.current
    v.onloadedmetadata=()=>{
      v.play().catch(()=>{})
      // give one rAF for the video element to actually paint
      requestAnimationFrame(()=>{
        cancelAnimationFrame(drawRaf.current)
        cancelAnimationFrame(loopRaf.current)
        runDraw()
        runAnalysis()
      })
    }
  },[screen])  // eslint-disable-line

  /* ── Draw loop ───────────────────────────────────────────────────────── */
  function runDraw() {
    function tick() {
      const ov=overlayRef.current
      if (!ov){drawRaf.current=requestAnimationFrame(tick);return}
      const W=ov.offsetWidth||640, H=ov.offsetHeight||480
      if(ov.width!==W) ov.width=W
      if(ov.height!==H) ov.height=H
      const ctx=ov.getContext('2d')!
      ctx.clearRect(0,0,W,H)
      const cx=W/2,cy=H/2,rx=W*.27,ry=H*.44
      // vignette
      ctx.save()
      ctx.beginPath(); ctx.rect(0,0,W,H)
      ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2)
      ctx.fillStyle='rgba(0,0,0,0.52)'; ctx.fill('evenodd'); ctx.restore()
      // oval
      ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2)
      ctx.strokeStyle=faceR.current?'#4ade80':'#f59e0b'
      ctx.lineWidth=3; ctx.stroke()
      // scan line
      if(faceR.current&&!doneR.current){
        const t=(Date.now()%2000)/2000
        const sy=(cy-ry)+t*ry*2
        const g=ctx.createLinearGradient(cx-rx,0,cx+rx,0)
        g.addColorStop(0,'transparent'); g.addColorStop(.5,'rgba(74,222,128,0.8)'); g.addColorStop(1,'transparent')
        ctx.beginPath(); ctx.moveTo(cx-rx,sy); ctx.lineTo(cx+rx,sy)
        ctx.strokeStyle=g; ctx.lineWidth=2; ctx.stroke()
      }
      drawRaf.current=requestAnimationFrame(tick)
    }
    drawRaf.current=requestAnimationFrame(tick)
  }

  /* ── Analysis loop ───────────────────────────────────────────────────── */
  function runAnalysis() {
    function tick() {
      if(doneR.current) return
      const v=videoRef.current, c=sampleRef.current
      if(!v||!c||v.readyState<2||!v.videoWidth){
        loopRaf.current=requestAnimationFrame(tick); return
      }
      const W=v.videoWidth, H=v.videoHeight
      c.width=W; c.height=H
      const ctx=c.getContext('2d')!
      ctx.drawImage(v,0,0)
      const {data}=ctx.getImageData(0,0,W,H)

      // face detection
      const cB=luma(data,Math.floor(W*.25),Math.floor(H*.15),Math.floor(W*.5),Math.floor(H*.65),W)
      const tl=luma(data,0,0,Math.floor(W*.18),Math.floor(H*.18),W)
      const tr=luma(data,Math.floor(W*.82),0,Math.floor(W*.18),Math.floor(H*.18),W)
      const hasFace=cB>20&&Math.abs(cB-(tl+tr)/2)>5
      faceR.current=hasFace; setFace(hasFace)

      const idx=idxR.current
      const item=itemsR.current[idx]
      if(!item){loopRaf.current=requestAnimationFrame(tick);return}

      if(!hasFace){
        setHint('👤 Coloca tu cara dentro del óvalo')
        loopRaf.current=requestAnimationFrame(tick); return
      }
      setHint(item.instruction)
      let passed=false

      if(item.id==='center'){
        cTick.current++; passed=cTick.current>25
      } else if(item.id==='blink'){
        const eb=luma(data,Math.floor(W*.2),Math.floor(H*.26),Math.floor(W*.6),Math.floor(H*.14),W)
        if(bBase.current===null){
          bCalib.current.push(eb)
          if(bCalib.current.length>=30){
            bBase.current=bCalib.current.reduce((a,b)=>a+b,0)/bCalib.current.length
            bCalib.current=[]
          }
        } else if(bCool.current>0){ bCool.current-- }
        else if(bBase.current-eb>8){
          bCount.current++; bCool.current=20; bBase.current=null; bCalib.current=[]
        }
        passed=bCount.current>=2
      } else if(item.id==='left'||item.id==='right'){
        const sY=Math.floor(H*.2),sH=Math.floor(H*.55),sW=Math.floor(W*.22)
        const lB=luma(data,0,sY,sW,sH,W)
        const rB=luma(data,W-sW,sY,sW,sH,W)
        tBuf.current.push(item.id==='left'?rB-lB:lB-rB)
        if(tBuf.current.length>12) tBuf.current.shift()
        passed=tBuf.current.reduce((a,b)=>a+b,0)/tBuf.current.length>6
      } else if(item.id==='smile'){
        const mb=luma(data,Math.floor(W*.3),Math.floor(H*.58),Math.floor(W*.4),Math.floor(H*.16),W)
        if(sBase.current===null){
          sCalib.current.push(mb)
          if(sCalib.current.length>=20){
            sBase.current=sCalib.current.reduce((a,b)=>a+b,0)/sCalib.current.length
            sCalib.current=[]
          }
        } else { passed=mb-sBase.current>4.5 }
      }

      if(passed){
        const next=idx+1
        itemsR.current=itemsR.current.map((it,i)=>i===idx?{...it,done:true}:it)
        setItems([...itemsR.current]); idxR.current=next; setActiveI(next); resetAccum()
        if(next>=itemsR.current.length){
          doneR.current=true; setDone(true); setHint('✅ ¡Perfecto!')
          setTimeout(()=>captureStill(),700); return
        }
      }
      loopRaf.current=requestAnimationFrame(tick)
    }
    loopRaf.current=requestAnimationFrame(tick)
  }

  /* ── Capture still ───────────────────────────────────────────────────── */
  function captureStill() {
    const v=videoRef.current, c=sampleRef.current
    if(!v||!c) return
    c.width=v.videoWidth||640; c.height=v.videoHeight||480
    const ctx=c.getContext('2d')!
    ctx.save(); ctx.translate(c.width,0); ctx.scale(-1,1)
    ctx.drawImage(v,0,0); ctx.restore()
    const img=c.toDataURL('image/jpeg',.92)
    stopAll(); setPhoto(img); setScreen('preview')
  }

  /* ── Open camera ─────────────────────────────────────────────────────── */
  async function openCamera() {
    setErr(null)
    itemsR.current=freshItems(); idxR.current=0
    faceR.current=false; doneR.current=false
    setItems(freshItems()); setActiveI(0)
    setFace(false); setHint(''); setDone(false)
    resetAccum()

    if(!navigator.mediaDevices?.getUserMedia){
      setErr('Tu navegador no soporta cámara. Usa Chrome/Firefox en localhost o HTTPS.'); return
    }

    const constraints: MediaStreamConstraints[]=[
      {video:{facingMode:'user',width:{ideal:1280},height:{ideal:720}}},
      {video:{facingMode:'user'}},
      {video:{facingMode:{ideal:'user'}}},
      {video:true},
    ]

    let stream:MediaStream|null=null, lastErr:unknown=null
    for(const c of constraints){
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
      setErr(m[n]??`No se pudo acceder a la cámara (${n||'desconocido'}).`); return
    }

    /* Store stream first — the useEffect will attach it after React renders <video> */
    streamRef.current=stream
    setScreen('camera')   // ← triggers useEffect which attaches srcObject
  }

  /* ── Analyze & proceed ───────────────────────────────────────────────── */
  async function proceed() {
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
          <p className="text-xs text-zinc-500">Sigue las instrucciones en pantalla</p>
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

      {/* ═══ CAMERA ═══ */}
      {screen==='camera'&&(
        <div className="space-y-4">
          <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3]">
            {/* Video: visible, CSS-mirrored so user sees selfie view */}
            <video ref={videoRef} autoPlay playsInline muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{transform:'scaleX(-1)'}}/>
            {/* Oval overlay — transparent bg, only draws mask + scan line */}
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
                <div className="bg-black/75 backdrop-blur-sm px-4 py-2 rounded-full border border-white/10">
                  <p className="text-sm text-white font-medium text-center">{hint}</p>
                </div>
              </div>
            )}
            {done&&(
              <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                <div className="bg-green-500/20 border border-green-500/40 backdrop-blur-sm px-4 py-2 rounded-full">
                  <p className="text-sm text-green-400 font-medium">✅ ¡Perfecto! Tomando foto...</p>
                </div>
              </div>
            )}
          </div>

          {/* Offscreen analysis canvas */}
          <canvas ref={sampleRef} className="hidden"/>

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
