'use client'

import { useKYCStore } from '@/lib/kyc-store'
import KYCSidebar from '@/components/kyc/KYCSidebar'
import MobileHeader from '@/components/kyc/MobileHeader'
import WelcomeStep from '@/components/kyc/WelcomeStep'
import PersonalInfoStep from '@/components/kyc/PersonalInfoStep'
import DocumentTypeStep from '@/components/kyc/DocumentTypeStep'
import { DocumentFrontStep, DocumentBackStep } from '@/components/kyc/DocumentSteps'
import SelfieStep from '@/components/kyc/SelfieStep'
import ReviewStep from '@/components/kyc/ReviewStep'
import { ProcessingStep, CompleteStep } from '@/components/kyc/ProcessingComplete'
import { KYCStep } from '@/lib/kyc-store'

const prevStepMap: Partial<Record<KYCStep, KYCStep>> = {
  'personal-info': 'welcome',
  'document-type': 'personal-info',
  'document-front': 'document-type',
  'document-back': 'document-front',
  'selfie': 'document-front',
  'review': 'selfie',
}

export default function KYCPage() {
  const { currentStep, completedSteps, setStep } = useKYCStore()

  const handleBack = () => {
    const prev = prevStepMap[currentStep]
    if (prev) setStep(prev)
  }

  const renderStep = () => {
    switch (currentStep) {
      case 'welcome': return <WelcomeStep />
      case 'personal-info': return <PersonalInfoStep />
      case 'document-type': return <DocumentTypeStep />
      case 'document-front': return <DocumentFrontStep />
      case 'document-back': return <DocumentBackStep />
      case 'selfie': return <SelfieStep />
      case 'review': return <ReviewStep />
      case 'processing': return <ProcessingStep />
      case 'complete': return <CompleteStep />
      default: return <WelcomeStep />
    }
  }

  const isFullscreen = currentStep === 'processing' || currentStep === 'complete'

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <KYCSidebar currentStep={currentStep} completedSteps={completedSteps} />

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Mobile header */}
        <MobileHeader currentStep={currentStep} onBack={handleBack} />

        {/* Content area */}
        <main className={`flex-1 flex items-center justify-center px-6 py-10 ${isFullscreen ? '' : ''}`}>
          <div className="w-full max-w-2xl">
            {renderStep()}
          </div>
        </main>

        {/* Footer */}
        <footer className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
          <p className="text-[11px] text-zinc-700">© 2024 TrustVerify · Todos los derechos reservados</p>
          <div className="flex gap-4">
            <a href="#" className="text-[11px] text-zinc-700 hover:text-zinc-500">Privacidad</a>
            <a href="#" className="text-[11px] text-zinc-700 hover:text-zinc-500">Términos</a>
            <a href="#" className="text-[11px] text-zinc-700 hover:text-zinc-500">Soporte</a>
          </div>
        </footer>
      </div>
    </div>
  )
}
