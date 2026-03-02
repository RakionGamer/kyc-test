import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'KYC Verification | Identity Verification',
  description: 'Secure identity verification process',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-[#0a0a0d] antialiased">
        {children}
      </body>
    </html>
  )
}
