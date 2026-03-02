'use client'

import { FileText, CreditCard, Car, ArrowRight, Check } from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'
import { useState } from 'react'
import clsx from 'clsx'

const docTypes = [
  {
    id: 'passport' as const,
    title: 'Pasaporte',
    description: 'Pasaporte vigente emitido por tu país de origen',
    icon: <FileText size={28} />,
    note: 'Mejor opción — aceptado mundialmente',
    color: 'from-blue-500/20 to-blue-600/10',
    border: 'border-blue-500/30',
    iconColor: 'text-blue-400',
  },
  {
    id: 'id-card' as const,
    title: 'Cédula / INE / DNI',
    description: 'Documento nacional de identidad oficial',
    icon: <CreditCard size={28} />,
    note: 'Aceptado en la mayoría de países',
    color: 'from-amber-500/20 to-amber-600/10',
    border: 'border-amber-500/30',
    iconColor: 'text-amber-400',
  },
  {
    id: 'drivers-license' as const,
    title: 'Licencia de conducir',
    description: 'Licencia de conducir oficial con foto',
    icon: <Car size={28} />,
    note: 'Disponible en países seleccionados',
    color: 'from-emerald-500/20 to-emerald-600/10',
    border: 'border-emerald-500/30',
    iconColor: 'text-emerald-400',
  },
]

export default function DocumentTypeStep() {
  const { setStep, setDocumentType, completeStep, documentType } = useKYCStore()
  const [selected, setSelected] = useState<typeof documentType>(documentType)

  const handleContinue = () => {
    if (!selected) return
    setDocumentType(selected)
    completeStep('document-type')
    setStep('document-front')
  }

  return (
    <div className="fade-in-up max-w-xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
          Selecciona tu documento
        </h2>
        <p className="text-sm text-zinc-500">
          Elige el tipo de documento que utilizarás para verificar tu identidad. Asegúrate de que esté vigente y en buen estado.
        </p>
      </div>

      <div className="flex flex-col gap-3 mb-8">
        {docTypes.map(doc => (
          <button
            key={doc.id}
            onClick={() => setSelected(doc.id)}
            className={clsx(
              'relative flex items-center gap-5 p-5 rounded-2xl border text-left transition-all duration-200 group',
              selected === doc.id
                ? `bg-gradient-to-r ${doc.color} ${doc.border} scale-[1.01]`
                : 'bg-white/3 border-white/8 hover:border-white/15 hover:bg-white/5'
            )}
          >
            {/* Icon */}
            <div className={clsx(
              'w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/5 transition-colors',
              selected === doc.id ? doc.iconColor : 'text-zinc-500'
            )}>
              {doc.icon}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm mb-0.5" style={{ fontFamily: 'Syne, sans-serif' }}>
                {doc.title}
              </p>
              <p className="text-xs text-zinc-400 mb-2">{doc.description}</p>
              <span className="text-[10px] text-zinc-600">{doc.note}</span>
            </div>

            {/* Check */}
            <div className={clsx(
              'w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
              selected === doc.id ? 'border-amber-500 bg-amber-500' : 'border-white/15'
            )}>
              {selected === doc.id && <Check size={12} className="text-black" />}
            </div>
          </button>
        ))}
      </div>

      {/* Tips */}
      <div className="bg-white/3 rounded-xl p-4 mb-6">
        <p className="text-xs font-medium text-zinc-300 mb-2">📋 Consejos para mejores resultados</p>
        <ul className="space-y-1">
          {[
            'El documento debe ser original (no fotocopias)',
            'Debe estar vigente y no dañado',
            'Todos los datos deben ser legibles',
            'Fecha de vencimiento visible',
          ].map((tip, i) => (
            <li key={i} className="text-[11px] text-zinc-500 flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-zinc-600" />
              {tip}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={handleContinue}
        disabled={!selected}
        className={clsx(
          'w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-sm transition-all duration-200',
          selected
            ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25'
            : 'bg-white/5 text-zinc-600 cursor-not-allowed'
        )}
        style={{ fontFamily: 'Syne, sans-serif' }}
      >
        Continuar con {selected ? docTypes.find(d => d.id === selected)?.title : '...'}
        <ArrowRight size={16} />
      </button>
    </div>
  )
}
