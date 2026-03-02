'use client'

import { Shield, Clock, CheckCircle, ArrowRight, Lock, Zap } from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'

const requirements = [
  'Documento de identidad oficial vigente',
  'Buena iluminación en tu entorno',
  'Cámara frontal funcional',
  'Conexión estable a internet',
]

const benefits = [
  { icon: <Lock size={14} />, text: 'Datos cifrados end-to-end' },
  { icon: <Zap size={14} />, text: 'Verificación en minutos' },
  { icon: <Shield size={14} />, text: 'Cumplimiento regulatorio' },
]

export default function WelcomeStep() {
  const { setStep } = useKYCStore()

  return (
    <div className="fade-in-up max-w-xl mx-auto">
      {/* Hero badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-6">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-xs text-amber-400 font-medium">Verificación KYC Requerida</span>
      </div>

      <h1 className="text-4xl font-bold text-white mb-3 leading-tight" style={{ fontFamily: 'Syne, sans-serif' }}>
        Verifica tu<br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-300">
          identidad
        </span>
      </h1>

      <p className="text-zinc-400 text-base mb-8 leading-relaxed">
        Necesitamos verificar tu identidad para cumplir con las regulaciones internacionales contra el lavado de dinero (AML) y conoce a tu cliente (KYC).
      </p>

      {/* Time estimate */}
      <div className="flex items-center gap-2 mb-8">
        <Clock size={14} className="text-amber-500" />
        <span className="text-sm text-zinc-400">Proceso completo: <span className="text-white font-medium">3–5 minutos</span></span>
      </div>

      {/* Requirements */}
      <div className="bg-white/3 border border-white/6 rounded-2xl p-5 mb-6">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">
          Lo que necesitas
        </p>
        <div className="flex flex-col gap-2.5">
          {requirements.map((req, i) => (
            <div key={i} className="flex items-center gap-3">
              <CheckCircle size={14} className="text-amber-500 flex-shrink-0" />
              <span className="text-sm text-zinc-300">{req}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Benefits row */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {benefits.map((b, i) => (
          <div key={i} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/3 border border-white/5 text-center">
            <span className="text-amber-500">{b.icon}</span>
            <span className="text-[11px] text-zinc-400">{b.text}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => setStep('personal-info')}
        className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 active:scale-[0.98]"
        style={{ fontFamily: 'Syne, sans-serif' }}
      >
        Comenzar verificación
        <ArrowRight size={16} />
      </button>

      <p className="text-center text-[11px] text-zinc-600 mt-4">
        Al continuar, aceptas nuestra{' '}
        <a href="#" className="text-amber-500/70 underline">Política de Privacidad</a>
        {' '}y los{' '}
        <a href="#" className="text-amber-500/70 underline">Términos de Servicio</a>
      </p>
    </div>
  )
}
