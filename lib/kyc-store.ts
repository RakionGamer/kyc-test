import { create } from 'zustand'

export type KYCStep = 
  | 'welcome'
  | 'personal-info'
  | 'document-type'
  | 'document-front'
  | 'document-back'
  | 'selfie'
  | 'review'
  | 'processing'
  | 'complete'

export interface PersonalInfo {
  firstName: string
  lastName: string
  dateOfBirth: string
  nationality: string
  email: string
  phone: string
  address: string
  city: string
  country: string
  postalCode: string
}

export interface KYCState {
  currentStep: KYCStep
  completedSteps: KYCStep[]
  personalInfo: Partial<PersonalInfo>
  documentType: 'passport' | 'id-card' | 'drivers-license' | null
  documentFront: string | null
  documentBack: string | null
  selfieImage: string | null
  livenessScore: number
  setStep: (step: KYCStep) => void
  setPersonalInfo: (info: Partial<PersonalInfo>) => void
  setDocumentType: (type: 'passport' | 'id-card' | 'drivers-license') => void
  setDocumentFront: (image: string) => void
  setDocumentBack: (image: string) => void
  setSelfie: (image: string, score: number) => void
  completeStep: (step: KYCStep) => void
  reset: () => void
}

export const useKYCStore = create<KYCState>((set) => ({
  currentStep: 'welcome',
  completedSteps: [],
  personalInfo: {},
  documentType: null,
  documentFront: null,
  documentBack: null,
  selfieImage: null,
  livenessScore: 0,

  setStep: (step) => set({ currentStep: step }),
  
  setPersonalInfo: (info) =>
    set((state) => ({ personalInfo: { ...state.personalInfo, ...info } })),
  
  setDocumentType: (type) => set({ documentType: type }),
  
  setDocumentFront: (image) => set({ documentFront: image }),
  
  setDocumentBack: (image) => set({ documentBack: image }),
  
  setSelfie: (image, score) => set({ selfieImage: image, livenessScore: score }),
  
  completeStep: (step) =>
    set((state) => ({
      completedSteps: state.completedSteps.includes(step)
        ? state.completedSteps
        : [...state.completedSteps, step],
    })),
  
  reset: () =>
    set({
      currentStep: 'welcome',
      completedSteps: [],
      personalInfo: {},
      documentType: null,
      documentFront: null,
      documentBack: null,
      selfieImage: null,
      livenessScore: 0,
    }),
}))
