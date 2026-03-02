# TrustVerify KYC — Documentación del Proyecto

Una aplicación de verificación KYC (Know Your Customer) estilo Binance, construida con **Next.js 14**, **React**, **Tailwind CSS** y **Zustand**.

---

## 🚀 Instalación y uso

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar en desarrollo
npm run dev

# 3. Abrir en el navegador
# http://localhost:3000
```

---

## 📁 Estructura del proyecto

```
kyc-app/
├── app/
│   ├── globals.css          # Estilos globales + animaciones
│   ├── layout.tsx           # Layout raíz con fuentes
│   ├── page.tsx             # Redirección a /kyc
│   └── kyc/
│       └── page.tsx         # Página principal KYC
│
├── components/
│   └── kyc/
│       ├── KYCSidebar.tsx       # Sidebar de progreso (desktop)
│       ├── MobileHeader.tsx     # Header progreso (mobile)
│       ├── WelcomeStep.tsx      # Paso 0: Bienvenida
│       ├── PersonalInfoStep.tsx # Paso 1: Datos personales
│       ├── DocumentTypeStep.tsx # Paso 2: Tipo de documento
│       ├── DocumentCapture.tsx  # Componente reutilizable de captura
│       ├── DocumentSteps.tsx    # Paso 3/4: Frente y reverso
│       ├── SelfieStep.tsx       # Paso 5: Verificación facial
│       ├── ReviewStep.tsx       # Paso 6: Revisión final
│       └── ProcessingComplete.tsx # Paso 7/8: Procesando y Éxito
│
├── lib/
│   └── kyc-store.ts         # Estado global con Zustand
│
├── tailwind.config.js
├── next.config.js
├── tsconfig.json
└── package.json
```

---

## 🔧 Stack técnico

| Tecnología | Uso |
|---|---|
| **Next.js 14** | Framework React con App Router |
| **TypeScript** | Tipado estático |
| **Tailwind CSS** | Estilos utilitarios |
| **Zustand** | Estado global de la sesión KYC |
| **Lucide React** | Iconografía |
| **Web APIs** | `navigator.mediaDevices` para cámara |

---

## 🎯 Funcionalidades

### ✅ Flujo de verificación completo
1. **Bienvenida** — Intro con requisitos y beneficios
2. **Información Personal** — Formulario con validación básica
3. **Tipo de Documento** — Pasaporte, INE/Cédula, Licencia
4. **Captura Frontal** — Cámara o subida de archivo
5. **Captura Posterior** — Reverso del documento (si aplica)
6. **Verificación Facial** — Cámara frontal + liveness checks simulados
7. **Revisión Final** — Resumen + checkbox de consentimiento
8. **Procesamiento** — Animación de análisis
9. **Completado** — Pantalla de éxito con nivel KYC

### 📸 Reconocimiento facial / Selfie
- Acceso a cámara frontal del dispositivo via `getUserMedia`
- Overlay con óvalo detector + scan line animado
- Simulación de **liveness checks** (centra rostro → mira cámara → parpadea → sonríe)
- Cuenta regresiva automática antes de capturar
- Análisis biométrico simulado con barra de progreso circular

### 🎨 Diseño
- Tema oscuro premium (estilo Binance/crypto)
- Tipografía: **Syne** (display) + **DM Sans** (body)
- Sidebar de progreso en desktop
- Header con barra de progreso en mobile
- Animaciones CSS personalizadas

---

## 🔌 Integración con backend real

Para conectar con un backend real, reemplaza las simulaciones en:

### `SelfieStep.tsx` — Análisis facial real
```typescript
// Reemplazar la simulación por llamada real:
const analyzeAndConfirm = async () => {
  const formData = new FormData()
  formData.append('selfie', dataURLtoBlob(capturedImage))
  formData.append('document', dataURLtoBlob(documentFront))
  
  const result = await fetch('/api/kyc/analyze-face', {
    method: 'POST',
    body: formData
  })
  const { score, verified } = await result.json()
  setSelfie(capturedImage, score)
}
```

### `ProcessingComplete.tsx` — Verificación AML real
```typescript
// Conectar con proveedor KYC (Sumsub, Jumio, Onfido, etc.)
const submitKYC = async () => {
  await fetch('/api/kyc/submit', {
    method: 'POST',
    body: JSON.stringify(kycStore.getState())
  })
}
```

### APIs KYC recomendadas
- **Sumsub** — API robusta, ideal para crypto
- **Jumio** — Enterprise grade, ML nativo
- **Onfido** — Fácil integración, SDK disponible
- **Au10tix** — Especializado en identidad

---

## 🔒 Consideraciones de seguridad

Para producción, asegúrate de:
- [ ] Transmitir imágenes solo por HTTPS
- [ ] No almacenar biometría en cliente (solo enviar al servidor)
- [ ] Implementar rate limiting en endpoints
- [ ] Cifrar datos en reposo (AES-256)
- [ ] Compliance con GDPR / Ley Fintech México
- [ ] Eliminar datos después del plazo legal

---

## 📱 Responsive

- **Desktop (lg+):** Sidebar de progreso + contenido central
- **Mobile:** Header con barra de progreso + contenido full-width
