'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Shield, ArrowRight, Home } from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'

const processingSteps = [
  { label: 'Verificando datos personales', duration: 1200 },
  { label: 'Validando documento de identidad', duration: 1500 },
  { label: 'Procesando biometría facial', duration: 1800 },
  { label: 'Revisión de cumplimiento AML', duration: 1200 },
  { label: 'Generando informe de verificación', duration: 1000 },
]

export function ProcessingStep() {
  const { setStep, completeStep } = useKYCStore()
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<number[]>([])
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let stepIdx = 0
    let totalTime = 0
    const total = processingSteps.reduce((s, p) => s + p.duration, 0)

    const runStep = () => {
      if (stepIdx >= processingSteps.length) {
        setProgress(100)
        setTimeout(() => {
          completeStep('processing')
          setStep('complete')
        }, 600)
        return
      }

      setCurrentStep(stepIdx)
      const duration = processingSteps[stepIdx].duration

      setTimeout(() => {
        setCompletedSteps(prev => [...prev, stepIdx])
        totalTime += duration
        setProgress(Math.round((totalTime / total) * 100))
        stepIdx++
        runStep()
      }, duration)
    }

    runStep()
  }, [])

  return (
    <div className="fade-in-up max-w-md mx-auto text-center">
      {/* Animated logo */}
      <div className="relative w-24 h-24 mx-auto mb-8">
        <div className="w-24 h-24 rounded-full border-2 border-amber-500/20 flex items-center justify-center">
          <Shield size={36} className="text-amber-500" />
        </div>
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="44" fill="none" stroke="#27272a" strokeWidth="3" />
          <circle
            cx="48" cy="48" r="44" fill="none" stroke="#f59e0b" strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 44}`}
            strokeDashoffset={`${2 * Math.PI * 44 * (1 - progress / 100)}`}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
        Procesando verificación
      </h2>
      <p className="text-sm text-zinc-500 mb-8">
        Por favor espera mientras verificamos tu identidad. Este proceso puede tomar unos momentos.
      </p>

      {/* Steps list */}
      <div className="text-left space-y-3 mb-8">
        {processingSteps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
              completedSteps.includes(i)
                ? 'bg-green-500/20 border border-green-500/40'
                : i === currentStep
                ? 'border border-amber-500'
                : 'border border-white/10'
            }`}>
              {completedSteps.includes(i) ? (
                <CheckCircle2 size={14} className="text-green-400" />
              ) : i === currentStep ? (
                <div className="w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
              ) : null}
            </div>
            <span className={`text-sm transition-colors ${
              completedSteps.includes(i) ? 'text-green-400' : i === currentStep ? 'text-white' : 'text-zinc-600'
            }`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="text-xs text-zinc-600 mt-2">{progress}%</p>
    </div>
  )
}

export function CompleteStep() {
  const { reset, personalInfo } = useKYCStore()

  return (
    <div className="fade-in-up max-w-md mx-auto text-center">
      {/* Success animation */}
      <div className="relative w-28 h-28 mx-auto mb-8">
        <div className="w-28 h-28 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
          <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none">
            <circle cx="32" cy="32" r="30" fill="none" stroke="#22c55e" strokeWidth="2" />
            <path
              d="M18 32 L27 41 L46 22"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="checkmark-path"
            />
          </svg>
        </div>
        {/* Particles */}
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1.5 h-1.5 rounded-full bg-amber-400"
            style={{
              top: '50%', left: '50%',
              transform: `rotate(${i * 45}deg) translateY(-50px)`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>

      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 mb-6">
        <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
        <span className="text-xs text-green-400 font-medium">Verificación completada</span>
      </div>

      <h2 className="text-3xl font-bold text-white mb-3" style={{ fontFamily: 'Syne, sans-serif' }}>
        ¡Felicidades,<br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-300">
          {personalInfo.firstName}!
        </span>
      </h2>

      <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
        Tu identidad ha sido verificada exitosamente. Tu cuenta ahora tiene acceso completo a todas las funcionalidades de la plataforma.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'Nivel KYC', value: 'Completo', icon: '🔐' },
          { label: 'Estado', value: 'Aprobado', icon: '✅' },
          { label: 'Límites', value: 'Sin límite', icon: '♾️' },
        ].map(item => (
          <div key={item.label} className="bg-white/3 border border-white/8 rounded-xl p-3">
            <div className="text-2xl mb-1">{item.icon}</div>
            <p className="text-xs font-bold text-white" style={{ fontFamily: 'Syne, sans-serif' }}>{item.value}</p>
            <p className="text-[10px] text-zinc-500">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={reset}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 border border-white/8 text-zinc-300 text-sm hover:bg-white/8 transition-all"
        >
          <Home size={14} /> Inicio
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-bold text-sm hover:scale-[1.02] transition-all"
          style={{ fontFamily: 'Syne, sans-serif' }}
        >
          Ir al panel <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
