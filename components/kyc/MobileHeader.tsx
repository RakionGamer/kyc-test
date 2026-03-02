'use client'

import { Shield, ChevronLeft } from 'lucide-react'
import { KYCStep } from '@/lib/kyc-store'

const stepOrder: KYCStep[] = ['welcome', 'personal-info', 'document-type', 'document-front', 'document-back', 'selfie', 'review', 'processing', 'complete']
const totalSteps = 6

interface MobileHeaderProps {
  currentStep: KYCStep
  onBack?: () => void
}

export default function MobileHeader({ currentStep, onBack }: MobileHeaderProps) {
  const idx = stepOrder.indexOf(currentStep)
  const progress = Math.min(Math.max((idx / (stepOrder.length - 1)) * 100, 0), 100)

  const showBack = !['welcome', 'processing', 'complete'].includes(currentStep)

  return (
    <div className="lg:hidden sticky top-0 z-30 bg-[#0a0a0d]/90 backdrop-blur-md border-b border-white/5">
      <div className="flex items-center gap-3 px-4 py-3">
        {showBack && onBack ? (
          <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
            <ChevronLeft size={16} className="text-zinc-400" />
          </button>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center">
            <Shield size={14} className="text-black" />
          </div>
        )}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-white" style={{ fontFamily: 'Syne, sans-serif' }}>TrustVerify KYC</p>
            <p className="text-[10px] text-zinc-500">{Math.round(progress)}%</p>
          </div>
          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-yellow-400 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
