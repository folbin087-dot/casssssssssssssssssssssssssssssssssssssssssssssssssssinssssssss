import type { Metadata, Viewport } from 'next'
import { Rubik, Geist_Mono } from 'next/font/google'
import Script from 'next/script'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const rubik = Rubik({
  subsets: ["latin", "cyrillic"],
  variable: "--font-rubik",
})
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'PLAID - Сервис мгновенных игр',
  description: 'PLAID - официальный сервис мгновенных игр. Dice, Mines, Wheel, Bubbles, BlackJack, Roulette и другие игры.',
}

export const viewport: Viewport = {
  themeColor: '#0f1923',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru">
      <head>
        {/*
          Telegram WebApp SDK.
          Loaded with beforeInteractive so window.Telegram.WebApp is available
          before any client component hydrates. Without this, useEffect hooks
          that read window.Telegram synchronously miss the SDK on first render
          and treat the user as a plain browser visitor (the root cause of the
          "bot sees a browser user instead of a Mini App user" bug).
        */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={`${rubik.variable} font-sans antialiased`}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
