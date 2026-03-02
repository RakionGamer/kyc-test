'use client'

import { useState } from 'react'
import { ArrowRight, User } from 'lucide-react'
import { useKYCStore, PersonalInfo } from '@/lib/kyc-store'
import clsx from 'clsx'

interface FieldProps {
  label: string
  name: keyof PersonalInfo
  type?: string
  placeholder?: string
  required?: boolean
  value: string
  onChange: (name: keyof PersonalInfo, value: string) => void
}

function Field({ label, name, type = 'text', placeholder, required, value, onChange }: FieldProps) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">
        {label} {required && <span className="text-amber-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(name, e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className={clsx(
          'w-full bg-white/3 border rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition-all duration-200',
          focused ? 'border-amber-500/60 bg-amber-500/5' : 'border-white/8 hover:border-white/15'
        )}
      />
    </div>
  )
}

const countries = [
  'México', 'Argentina', 'Colombia', 'Chile', 'Perú', 'Venezuela', 'Ecuador',
  'Bolivia', 'Paraguay', 'Uruguay', 'España', 'Estados Unidos', 'Otro'
]

export default function PersonalInfoStep() {
  const { setStep, setPersonalInfo, personalInfo, completeStep } = useKYCStore()
  const [form, setForm] = useState<Partial<PersonalInfo>>(personalInfo || {})

  const handleChange = (name: keyof PersonalInfo, value: string) => {
    setForm(prev => ({ ...prev, [name]: value }))
  }

  const isValid = form.firstName && form.lastName && form.dateOfBirth && form.email && form.nationality

  const handleSubmit = () => {
    if (!isValid) return
    setPersonalInfo(form)
    completeStep('personal-info')
    setStep('document-type')
  }

  return (
    <div className="fade-in-up max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
          <User size={18} className="text-amber-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Syne, sans-serif' }}>
            Información Personal
          </h2>
          <p className="text-xs text-zinc-500">Ingresa tus datos tal como aparecen en tu documento</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Field label="Nombre(s)" name="firstName" placeholder="Ej: Juan Carlos" required value={form.firstName || ''} onChange={handleChange} />
        <Field label="Apellido(s)" name="lastName" placeholder="Ej: García López" required value={form.lastName || ''} onChange={handleChange} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Field label="Fecha de nacimiento" name="dateOfBirth" type="date" required value={form.dateOfBirth || ''} onChange={handleChange} />
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">
            Nacionalidad <span className="text-amber-500">*</span>
          </label>
          <select
            value={form.nationality || ''}
            onChange={e => handleChange('nationality', e.target.value)}
            className="w-full bg-white/3 border border-white/8 rounded-xl px-4 py-3 text-sm text-white outline-none transition-all duration-200 hover:border-white/15 focus:border-amber-500/60 focus:bg-amber-500/5"
          >
            <option value="" className="bg-zinc-900">Seleccionar</option>
            {countries.map(c => (
              <option key={c} value={c} className="bg-zinc-900">{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Field label="Correo electrónico" name="email" type="email" placeholder="correo@ejemplo.com" required value={form.email || ''} onChange={handleChange} />
        <Field label="Teléfono" name="phone" type="tel" placeholder="+52 555 123 4567" value={form.phone || ''} onChange={handleChange} />
      </div>

      <div className="border-t border-white/5 pt-4 mt-4 mb-4">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">Dirección</p>
        <Field label="Dirección" name="address" placeholder="Calle, número, colonia" value={form.address || ''} onChange={handleChange} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <Field label="Ciudad" name="city" placeholder="Ciudad" value={form.city || ''} onChange={handleChange} />
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">País</label>
          <select
            value={form.country || ''}
            onChange={e => handleChange('country', e.target.value)}
            className="w-full bg-white/3 border border-white/8 rounded-xl px-4 py-3 text-sm text-white outline-none transition-all duration-200 hover:border-white/15 focus:border-amber-500/60 focus:bg-amber-500/5"
          >
            <option value="" className="bg-zinc-900">País</option>
            {countries.map(c => (
              <option key={c} value={c} className="bg-zinc-900">{c}</option>
            ))}
          </select>
        </div>
        <Field label="Código Postal" name="postalCode" placeholder="00000" value={form.postalCode || ''} onChange={handleChange} />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className={clsx(
          'w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-bold text-sm transition-all duration-200',
          isValid
            ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-500/25 active:scale-[0.98]'
            : 'bg-white/5 text-zinc-600 cursor-not-allowed'
        )}
        style={{ fontFamily: 'Syne, sans-serif' }}
      >
        Continuar
        <ArrowRight size={16} />
      </button>
    </div>
  )
}
