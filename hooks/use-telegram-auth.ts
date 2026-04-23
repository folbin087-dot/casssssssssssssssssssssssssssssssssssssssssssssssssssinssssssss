import { useState, useEffect } from 'react'

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

export function useTelegramAuth(): UseTelegramAuthReturn {
  const [telegramId, setTelegramId] = useState<string | null>(null)
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isTelegramApp, setIsTelegramApp] = useState(false)

  useEffect(() => {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds (50 * 100ms)
    let mounted = true

    const authenticateUser = async (tgId: string, initData?: string, telegramUser?: any) => {
      try {
        const response = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            initData: initData || '',
            user: telegramUser || { id: parseInt(tgId), first_name: 'User' },
          }),
        })

        const data = await response.json()
        
        if (mounted) {
          if (data.success && data.user) {
            setUser(data.user)
            setTelegramId(tgId)
            setError(null)
          } else {
            setError(data.error || 'Ошибка авторизации')
          }
          setIsLoading(false)
        }
      } catch (err) {
        console.error('Authentication error:', err)
        if (mounted) {
          setError('Ошибка подключения к серверу')
          setIsLoading(false)
        }
      }
    }

    const checkTelegram = async () => {
      attempts++

      // Check if Telegram WebApp SDK is loaded
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp
        
        try {
          // Initialize Telegram WebApp
          tg.ready()
          tg.expand()

          // Set theme
          if (tg.colorScheme === 'dark') {
            document.documentElement.classList.add('dark')
          }

          const initData = tg.initData
          const telegramUser = tg.initDataUnsafe?.user

          if (mounted) {
            setIsTelegramApp(true)
          }

          if (telegramUser?.id) {
            const tgId = String(telegramUser.id)
            
            // Save to localStorage for persistence
            localStorage.setItem('telegram_user_id', tgId)
            
            // Authenticate with server
            await authenticateUser(tgId, initData, telegramUser)
          } else {
            // No user data from Telegram, try localStorage fallback
            const savedId = localStorage.getItem('telegram_user_id')
            if (savedId && mounted) {
              setTelegramId(savedId)
              
              // Verify with server
              try {
                const response = await fetch(`/api/auth/telegram?telegramId=${savedId}`)
                const data = await response.json()
                
                if (mounted) {
                  if (data.authenticated && data.user) {
                    setUser(data.user)
                    setError(null)
                  } else {
                    // Saved ID is invalid, clear it
                    localStorage.removeItem('telegram_user_id')
                    setTelegramId(null)
                  }
                  setIsLoading(false)
                }
              } catch (err) {
                console.error('Auth check error:', err)
                if (mounted) {
                  setIsLoading(false)
                }
              }
            } else if (mounted) {
              setError('Не удалось получить данные пользователя из Telegram')
              setIsLoading(false)
            }
          }
        } catch (err) {
          console.error('Telegram initialization error:', err)
          if (mounted) {
            setError('Ошибка инициализации Telegram')
            setIsLoading(false)
          }
        }
      } else if (attempts < maxAttempts) {
        // SDK not loaded yet, wait and retry
        setTimeout(checkTelegram, 100)
      } else {
        // Timeout exceeded - SDK failed to load
        if (mounted) {
          // Try localStorage as last resort
          const savedId = localStorage.getItem('telegram_user_id')
          if (savedId) {
            setTelegramId(savedId)
            
            // Try to verify with server
            fetch(`/api/auth/telegram?telegramId=${savedId}`)
              .then(res => res.json())
              .then(data => {
                if (mounted && data.authenticated && data.user) {
                  setUser(data.user)
                  setIsTelegramApp(false)
                }
              })
              .catch(() => {
                // Ignore error
              })
              .finally(() => {
                if (mounted) {
                  setIsLoading(false)
                }
              })
          } else {
            setError('Telegram SDK не загружен. Пожалуйста, откройте приложение через Telegram.')
            setIsLoading(false)
          }
        }
      }
    }

    checkTelegram()

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
