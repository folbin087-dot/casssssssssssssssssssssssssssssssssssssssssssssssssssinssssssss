import { useState, useEffect, useCallback } from "react"
import { getTelegramAuthContext } from "@/lib/telegram-webapp"

interface UseUserBalanceReturn {
  balance: number
  setBalance: (balance: number) => void
  telegramId: string | null
  isLoading: boolean
  refetch: () => Promise<void>
  updateBalance: (amount: number, type: "add" | "subtract") => void
}

export function useUserBalance(): UseUserBalanceReturn {
  const [balance, setBalanceState] = useState(0)
  const [telegramId, setTelegramId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchBalance = useCallback(async () => {
    try {
      const ctx = await getTelegramAuthContext()
      const tgId = ctx.telegramId

      if (tgId) {
        setTelegramId(tgId)
        const response = await fetch(
          `/api/auth/telegram?telegramId=${encodeURIComponent(tgId)}`,
        )
        const data = await response.json()

        if (data.success && data.user) {
          setBalanceState(data.user.balance || 0)
        }
      }
    } catch (error) {
      console.error("Failed to fetch balance:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  const setBalance = useCallback((newBalance: number) => {
    setBalanceState(newBalance)
    window.dispatchEvent(
      new CustomEvent("balance-updated", { detail: { balance: newBalance } }),
    )
  }, [])

  const updateBalance = useCallback(
    (amount: number, type: "add" | "subtract") => {
      setBalanceState((prev) => {
        const newBalance =
          type === "add" ? prev + amount : Math.max(0, prev - amount)
        window.dispatchEvent(
          new CustomEvent("balance-updated", {
            detail: { balance: newBalance },
          }),
        )
        return newBalance
      })
    },
    [],
  )

  return {
    balance,
    setBalance,
    telegramId,
    isLoading,
    refetch: fetchBalance,
    updateBalance,
  }
}
