'use client'

import { useState } from 'react'
import { User, FileText, Camera, Eye, CheckCircle2, AlertCircle, ArrowRight, Edit2 } from 'lucide-react'
import { useKYCStore } from '@/lib/kyc-store'

export default function ReviewStep() {
  const { personalInfo, documentType, documentFront, documentBack, selfieImage, livenessScore, setStep, completeStep } = useKYCStore()
  const [agreed, setAgreed] = useState(false)

  const docTypeLabel = {
    'passport': 'Pasaporte',
    'id-card': 'Cédula / INE / DNI',
    'drivers-license': 'Licencia de conducir',
  }[documentType || 'id-card']

  const handleSubmit = () => {
    completeStep('review')
    setStep('processing')
  }

  const scoreColor = livenessScore >= 90 ? 'text-green-400' : livenessScore >= 75 ? 'text-amber-400' : 'text-red-400'

  return (
    <div className="fade-in-up max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: 'Syne, sans-serif' }}>
        Revisión Final
      </h2>
      <p className="text-sm text-zinc-500 mb-6">
        Verifica que toda tu información sea correcta antes de enviar.
      </p>

      {/* Personal info card */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <User size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-widest">Datos personales</span>
          </div>
          <button onClick={() => setStep('personal-info')} className="text-xs text-amber-500 flex items-center gap-1 hover:text-amber-400">
            <Edit2 size={11} /> Editar
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3">
          {[
            ['Nombre', `${personalInfo.firstName} ${personalInfo.lastName}`],
            ['Fecha de nac.', personalInfo.dateOfBirth || '—'],
            ['Nacionalidad', personalInfo.nationality || '—'],
            ['Email', personalInfo.email || '—'],
            ['Teléfono', personalInfo.phone || '—'],
            ['País', personalInfo.country || '—'],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-[10px] text-zinc-600 mb-0.5">{label}</p>
              <p className="text-sm text-white truncate">{val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Document card */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-widest">Documento: {docTypeLabel}</span>
          </div>
          <button onClick={() => setStep('document-front')} className="text-xs text-amber-500 flex items-center gap-1 hover:text-amber-400">
            <Edit2 size={11} /> Repetir
          </button>
        </div>
        <div className="flex gap-3">
          {documentFront && (
            <div className="flex-1">
              <p className="text-[10px] text-zinc-600 mb-1">Frente</p>
              <img src={documentFront} alt="Front" className="w-full rounded-lg object-cover aspect-[1.586/1]" />
            </div>
          )}
          {documentBack && (
            <div className="flex-1">
              <p className="text-[10px] text-zinc-600 mb-1">Reverso</p>
              <img src={documentBack} alt="Back" className="w-full rounded-lg object-cover aspect-[1.586/1]" />
            </div>
          )}
        </div>
      </div>

      {/* Selfie card */}
      <div className="bg-white/3 border border-white/8 rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Eye size={14} className="text-amber-400" />
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-widest">Verificación facial</span>
          </div>
          <button onClick={() => setStep('selfie')} className="text-xs text-amber-500 flex items-center gap-1 hover:text-amber-400">
            <Edit2 size={11} /> Repetir
          </button>
        </div>
        <div className="flex items-center gap-4">
          {selfieImage && (
            <img src={selfieImage} alt="Selfie" className="w-20 h-20 rounded-full object-cover border-2 border-amber-500/30" />
          )}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} className="text-green-400" />
              <span className="text-sm text-white">Prueba de vida completada</span>
            </div>
            <p className="text-xs text-zinc-500">Puntuación biométrica: <span className={`font-semibold ${scoreColor}`}>{livenessScore}/100</span></p>
            <p className="text-[10px] text-zinc-600 mt-1">Alta confianza — coincidencia verificada</p>
          </div>
        </div>
      </div>

      {/* Agreement */}
      <label className="flex items-start gap-3 mb-6 cursor-pointer group">
        <div
          className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border-2 transition-all ${agreed ? 'bg-amber-500 border-amber-500' : 'border-white/20 bg-transparent'}`}
          onClick={() => setAgreed(a => !a)}
        >
          {agreed && <CheckCircle2 size={12} className="text-black" />}
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Confirmo que la información proporcionada es verídica y corresponde a mi identidad real. Entiendo que proporcionar información falsa puede resultar en el bloqueo de mi cuenta y acciones legales.
        </p>
      </label>

      <button
        onClick={handleSubmit}
        disabled={!agreed}
        className={`w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-sm transition-all duration-200 ${
          agreed
            ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25'
            : 'bg-white/5 text-zinc-600 cursor-not-allowed'
        }`}
        style={{ fontFamily: 'Syne, sans-serif' }}
      >
        Enviar verificación
        <ArrowRight size={16} />
      </button>
    </div>
  )
}
