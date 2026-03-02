'use client'

import { Check, Shield, User, FileText, Camera, Eye, ClipboardCheck } from 'lucide-react'
import { KYCStep } from '@/lib/kyc-store'
import clsx from 'clsx'

interface Step {
  id: KYCStep
  label: string
  icon: React.ReactNode
  description: string
}

const steps: Step[] = [
  { id: 'personal-info', label: 'Información Personal', icon: <User size={16} />, description: 'Datos básicos' },
  { id: 'document-type', label: 'Tipo de Documento', icon: <FileText size={16} />, description: 'Selección de ID' },
  { id: 'document-front', label: 'Documento Frontal', icon: <Camera size={16} />, description: 'Foto del frente' },
  { id: 'document-back', label: 'Documento Posterior', icon: <Camera size={16} />, description: 'Foto del reverso' },
  { id: 'selfie', label: 'Verificación Facial', icon: <Eye size={16} />, description: 'Reconocimiento facial' },
  { id: 'review', label: 'Revisión Final', icon: <ClipboardCheck size={16} />, description: 'Confirmar datos' },
]

const stepOrder: KYCStep[] = ['welcome', 'personal-info', 'document-type', 'document-front', 'document-back', 'selfie', 'review', 'processing', 'complete']

interface SidebarProps {
  currentStep: KYCStep
  completedSteps: KYCStep[]
}

export default function KYCSidebar({ currentStep, completedSteps }: SidebarProps) {
  const currentIndex = stepOrder.indexOf(currentStep)

  const getStepStatus = (stepId: KYCStep): 'completed' | 'active' | 'upcoming' => {
    if (completedSteps.includes(stepId)) return 'completed'
    if (stepId === currentStep) return 'active'
    const stepIdx = stepOrder.indexOf(stepId)
    if (stepIdx < currentIndex) return 'completed'
    return 'upcoming'
  }

  return (
    <aside className="hidden lg:flex flex-col w-72 bg-[#0f0f14] border-r border-white/5 p-8 min-h-screen">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-12">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center">
          <Shield size={18} className="text-black" />
        </div>
        <div>
          <p className="font-bold text-white text-sm" style={{ fontFamily: 'Syne, sans-serif' }}>TrustVerify</p>
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">KYC Portal</p>
        </div>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-1">
        {steps.map((step, i) => {
          const status = getStepStatus(step.id)
          return (
            <div key={step.id} className="relative">
              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="absolute left-[19px] top-[42px] w-px h-6 bg-white/5">
                  {status === 'completed' && (
                    <div className="w-full h-full bg-amber-500/60" />
                  )}
                </div>
              )}
              
              <div className={clsx(
                'flex items-center gap-3 p-3 rounded-xl transition-all duration-300',
                status === 'active' && 'bg-amber-500/10 border border-amber-500/20',
                status === 'completed' && 'opacity-70',
                status === 'upcoming' && 'opacity-30',
              )}>
                {/* Icon circle */}
                <div className={clsx(
                  'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300',
                  status === 'completed' && 'bg-amber-500/20 text-amber-400',
                  status === 'active' && 'bg-amber-500 text-black',
                  status === 'upcoming' && 'bg-white/5 text-zinc-500',
                )}>
                  {status === 'completed' ? <Check size={14} /> : step.icon}
                </div>

                <div>
                  <p className={clsx(
                    'text-sm font-medium',
                    status === 'active' ? 'text-white' : 'text-zinc-400'
                  )} style={{ fontFamily: 'Syne, sans-serif' }}>
                    {step.label}
                  </p>
                  <p className="text-[10px] text-zinc-600">{step.description}</p>
                </div>

                {status === 'active' && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Security badge */}
      <div className="mt-auto pt-8 border-t border-white/5">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-white/3">
          <Shield size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-[11px] font-medium text-zinc-300">Proceso 100% seguro</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">Tus datos están cifrados con AES-256 y nunca son compartidos con terceros.</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
