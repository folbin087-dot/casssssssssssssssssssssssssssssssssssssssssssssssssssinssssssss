// Unified Telegram WebApp client helper
// - Waits for window.Telegram.WebApp SDK to be available
// - Exposes initData / user / auth helpers to be used by all client pages
//
// NOTE: The SDK script is injected from app/layout.tsx via next/script with
// strategy="beforeInteractive", so in practice window.Telegram.WebApp should
// already be present when components mount. The waitForTelegramWebApp helper
// is a defensive fallback in case of network issues or script blocking.

export interface TelegramUser {
  id: number
  first_name: string
  last_name?: string | null
  username?: string | null
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: {
    user?: TelegramUser
    query_id?: string
    auth_date?: number
    hash?: string
    start_param?: string
  }
  colorScheme?: "light" | "dark"
  ready: () => void
  expand: () => void
  close: () => void
  enableClosingConfirmation?: () => void
  disableVerticalSwipes?: () => void
  MainButton?: unknown
  BackButton?: unknown
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp
    }
  }
}

const SDK_WAIT_MS = 5000
const SDK_POLL_MS = 50

let sdkPromise: Promise<TelegramWebApp | null> | null = null

/**
 * Wait for the Telegram WebApp SDK to become available on window.Telegram.WebApp.
 * Resolves with the WebApp instance if found within SDK_WAIT_MS, otherwise null.
 * Memoizes the promise so repeated callers share the same wait.
 */
export function waitForTelegramWebApp(): Promise<TelegramWebApp | null> {
  if (typeof window === "undefined") return Promise.resolve(null)

  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve) => {
    if (window.Telegram?.WebApp) {
      resolve(window.Telegram.WebApp)
      return
    }

    const deadline = Date.now() + SDK_WAIT_MS
    const tick = () => {
      if (window.Telegram?.WebApp) {
        resolve(window.Telegram.WebApp)
        return
      }
      if (Date.now() >= deadline) {
        resolve(null)
        return
      }
      window.setTimeout(tick, SDK_POLL_MS)
    }
    tick()
  })

  return sdkPromise
}

/**
 * Returns the current Telegram WebApp instance, or null if SDK is not loaded.
 * Does NOT wait. Prefer waitForTelegramWebApp() inside effects.
 */
export function getTelegramWebAppSync(): TelegramWebApp | null {
  if (typeof window === "undefined") return null
  return window.Telegram?.WebApp ?? null
}

export interface TelegramAuthContext {
  webApp: TelegramWebApp | null
  user: TelegramUser | null
  initData: string
  telegramId: string | null
  isTelegramApp: boolean
}

/**
 * Resolve a Telegram auth context:
 *  1. Wait for SDK.
 *  2. If available and initData is present, return it.
 *  3. Otherwise fall back to a cached telegram_user_id from localStorage so
 *     users who previously authenticated in Telegram don't lose their session
 *     when the SDK fails to load.
 */
export async function getTelegramAuthContext(): Promise<TelegramAuthContext> {
  const webApp = await waitForTelegramWebApp()

  if (webApp) {
    try {
      webApp.ready()
    } catch {
      // ignore
    }
    try {
      webApp.expand()
    } catch {
      // ignore
    }
  }

  const user = webApp?.initDataUnsafe?.user ?? null
  const initData = webApp?.initData ?? ""

  let telegramId: string | null = user?.id ? String(user.id) : null

  if (!telegramId && typeof window !== "undefined") {
    telegramId = localStorage.getItem("telegram_user_id")
  }

  if (user?.id && typeof window !== "undefined") {
    try {
      localStorage.setItem("telegram_user_id", String(user.id))
    } catch {
      // ignore quota errors
    }
  }

  return {
    webApp,
    user,
    initData,
    telegramId,
    isTelegramApp: !!webApp && !!initData,
  }
}

/**
 * Convenience: POST /api/auth/telegram with the current initData.
 * Returns the server user on success, null otherwise.
 */
export async function authenticateWithTelegram(opts?: {
  referralCode?: string
}): Promise<unknown | null> {
  const ctx = await getTelegramAuthContext()

  if (!ctx.user || !ctx.initData) {
    if (!ctx.telegramId) return null
    // Cached ID only: verify with GET, don't send an unsigned POST.
    try {
      const res = await fetch(
        `/api/auth/telegram?telegramId=${encodeURIComponent(ctx.telegramId)}`,
      )
      const data = await res.json()
      return data?.user ?? null
    } catch {
      return null
    }
  }

  try {
    const res = await fetch("/api/auth/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        initData: ctx.initData,
        referralCode: opts?.referralCode,
      }),
    })
    const data = await res.json()
    return data?.success ? data.user : null
  } catch {
    return null
  }
}

export async function fetchTelegramBalance(): Promise<number | null> {
  const ctx = await getTelegramAuthContext()
  if (!ctx.telegramId) return null
  try {
    const res = await fetch(
      `/api/auth/telegram?telegramId=${encodeURIComponent(ctx.telegramId)}`,
    )
    const data = await res.json()
    if (data?.success && data.user) {
      return typeof data.user.balance === "number" ? data.user.balance : 0
    }
  } catch {
    // ignore
  }
  return null
}
