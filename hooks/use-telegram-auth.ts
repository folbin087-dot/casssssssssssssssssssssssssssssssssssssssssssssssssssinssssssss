import { useState, useEffect } from "react"
import { getTelegramAuthContext } from "@/lib/telegram-webapp"

interface TelegramUser {
  id: string
  telegram_id: string
  username?: string
  first_name: string
  last_name?: string
  balance: number
  referral_code: string
  is_admin: boolean
  is_partner: boolean
}

interface UseTelegramAuthReturn {
  telegramId: string | null
  user: TelegramUser | null
  isLoading: boolean
  error: string | null
  isAuthenticated: boolean
  isTelegramApp: boolean
}

/**
 * Hook that authenticates the current visitor against the Telegram Mini App
 * backend. Waits for the Telegram SDK, posts signed initData, and falls back
 * to a cached telegram_user_id if the SDK failed to load but the user has
 * authenticated before.
 */
export function useTelegramAuth(): UseTelegramAuthReturn {
  const [telegramId, setTelegramId] = useState<string | null>(null)
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isTelegramApp, setIsTelegramApp] = useState(false)

  useEffect(() => {
    let mounted = true

    const run = async () => {
      const ctx = await getTelegramAuthContext()
      if (!mounted) return

      setIsTelegramApp(ctx.isTelegramApp)
      if (ctx.telegramId) setTelegramId(ctx.telegramId)

      if (ctx.isTelegramApp && ctx.initData) {
        if (ctx.webApp?.colorScheme === "dark") {
          document.documentElement.classList.add("dark")
        }

        try {
          const res = await fetch("/api/auth/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData: ctx.initData }),
          })
          const data = await res.json()
          if (!mounted) return
          if (data.success && data.user) {
            setUser(data.user)
            setError(null)
          } else {
            setError(data.error || "Ошибка авторизации")
          }
        } catch (err) {
          console.error("Authentication error:", err)
          if (mounted) setError("Ошибка подключения к серверу")
        } finally {
          if (mounted) setIsLoading(false)
        }
        return
      }

      // No signed initData available – try to resume a previous session by
      // telegram_user_id, but do not create/update state without a signature.
      if (ctx.telegramId) {
        try {
          const res = await fetch(
            `/api/auth/telegram?telegramId=${encodeURIComponent(ctx.telegramId)}`,
          )
          const data = await res.json()
          if (!mounted) return
          if (data.authenticated && data.user) {
            setUser(data.user)
            setError(null)
          } else {
            localStorage.removeItem("telegram_user_id")
            setTelegramId(null)
          }
        } catch {
          /* ignore */
        } finally {
          if (mounted) setIsLoading(false)
        }
        return
      }

      if (mounted) {
        setError(
          "Не удалось получить данные пользователя из Telegram. Откройте приложение через бот в Telegram.",
        )
        setIsLoading(false)
      }
    }

    run()

    return () => {
      mounted = false
    }
  }, [])

  return {
    telegramId,
    user,
    isLoading,
    error,
    isAuthenticated: !!user && !!telegramId,
    isTelegramApp,
  }
}
