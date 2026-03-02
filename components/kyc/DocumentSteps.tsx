'use client'

import { useKYCStore } from '@/lib/kyc-store'
import DocumentCapture from './DocumentCapture'

export function DocumentFrontStep() {
  const { setStep, setDocumentFront, completeStep, documentType } = useKYCStore()

  const docLabel = {
    'passport': 'Página de datos de tu pasaporte',
    'id-card': 'Frente de tu cédula/INE/DNI',
    'drivers-license': 'Frente de tu licencia de conducir',
  }[documentType || 'id-card']

  const handleCapture = (image: string) => {
    setDocumentFront(image)
    completeStep('document-front')
    setStep(documentType === 'passport' ? 'selfie' : 'document-back')
  }

  return (
    <DocumentCapture
      title="Foto del documento — Frente"
      subtitle={`Captura el frente de tu ${documentType === 'passport' ? 'pasaporte' : 'documento'} con buena iluminación`}
      side="front"
      guideLabel={docLabel}
      onCapture={handleCapture}
    />
  )
}

export function DocumentBackStep() {
  const { setStep, setDocumentBack, completeStep, documentType } = useKYCStore()

  const docLabel = {
    'id-card': 'Reverso de tu cédula/INE/DNI',
    'drivers-license': 'Reverso de tu licencia de conducir',
    'passport': '',
  }[documentType || 'id-card']

  const handleCapture = (image: string) => {
    setDocumentBack(image)
    completeStep('document-back')
    setStep('selfie')
  }

  return (
    <DocumentCapture
      title="Foto del documento — Reverso"
      subtitle="Captura el reverso de tu documento con buena iluminación"
      side="back"
      guideLabel={docLabel}
      onCapture={handleCapture}
    />
  )
}
