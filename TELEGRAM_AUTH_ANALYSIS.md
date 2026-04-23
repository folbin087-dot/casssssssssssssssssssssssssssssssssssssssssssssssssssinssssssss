# Анализ авторизации через Telegram Mini App

## ❌ КРИТИЧЕСКИЕ ПРОБЛЕМЫ

### 1. **Отсутствует Telegram WebApp SDK**

**Проблема:** SDK не загружается в `<head>`, поэтому `window.Telegram.WebApp` всегда `undefined`

**Решение:** ✅ Добавлен скрипт в `app/layout.tsx`:

```tsx
<script src="https://telegram.org/js/telegram-web-app.js" async></script>
```

### 2. **Нет проверки загрузки SDK**

**Проблема:** Код пытается использовать `window.Telegram.WebApp` сразу, не дожидаясь загрузки SDK

**Решение:** Нужно добавить проверку готовности:

```tsx
useEffect(() => {
  const checkTelegram = () => {
    if (window.Telegram?.WebApp) {
      // SDK загружен, можно использовать
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      // ... остальной код
    } else {
      // SDK еще не загружен, ждем
      setTimeout(checkTelegram, 100);
    }
  };
  checkTelegram();
}, []);
```

### 3. **Fallback на localStorage без инициализации**

**Проблема:** Код проверяет `localStorage.getItem("telegram_user_id")`, но никогда не сохраняет туда значение

**Текущий код:**

```tsx
const savedId = localStorage.getItem("telegram_user_id"); // Всегда null!
```

**Решение:** Сохранять telegram_id после успешной авторизации:

```tsx
if (user?.id) {
  const telegramId = String(user.id);
  localStorage.setItem("telegram_user_id", telegramId);
  setTelegramId(telegramId);
}
```

## ⚠️ ПРОБЛЕМЫ СРЕДНЕЙ ВАЖНОСТИ

### 4. **Нет обработки ошибок загрузки SDK**

Если SDK не загрузится (блокировка, сетевая ошибка), пользователь не сможет авторизоваться

**Решение:** Добавить fallback UI:

```tsx
const [sdkLoaded, setSdkLoaded] = useState(false);
const [sdkError, setSDKError] = useState(false);

useEffect(() => {
  const timeout = setTimeout(() => {
    if (!window.Telegram?.WebApp) {
      setSDKError(true);
    }
  }, 5000); // 5 секунд на загрузку

  return () => clearTimeout(timeout);
}, []);

if (sdkError) {
  return <div>Пожалуйста, откройте приложение через Telegram</div>;
}
```

### 5. **Валидация initData может не работать в dev режиме**

**Текущее поведение:** Если `BOT_TOKEN` не установлен, валидация пропускается

**Проблема:** В production это создаст уязвимость

**Решение:** Всегда требовать `BOT_TOKEN` в production:

```tsx
if (!BOT_TOKEN && process.env.NODE_ENV === "production") {
  throw new Error("TELEGRAM_BOT_TOKEN must be set in production");
}
```

### 6. **Нет проверки, что приложение запущено в Telegram**

Пользователь может открыть сайт в обычном браузере

**Решение:** Добавить проверку:

```tsx
const isTelegramWebApp = () => {
  return window.Telegram?.WebApp?.initData !== undefined;
};

if (!isTelegramWebApp()) {
  return <div>Это приложение работает только в Telegram</div>;
}
```

## ✅ ЧТО РАБОТАЕТ ПРАВИЛЬНО

1. **Валидация initData** - правильная реализация по документации Telegram
2. **Создание пользователя** - корректная логика создания/обновления
3. **Проверка подписи** - использует `crypto.timingSafeEqual` для защиты от timing attacks
4. **Проверка auth_date** - защита от replay attacks (24 часа)
5. **API endpoints** - правильная структура POST/GET для авторизации

## 🔧 РЕКОМЕНДУЕМЫЕ ИСПРАВЛЕНИЯ

### Создать хук `useTelegramAuth`:

```tsx
// hooks/use-telegram-auth.ts
import { useState, useEffect } from "react";

export function useTelegramAuth() {
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 50; // 5 секунд (50 * 100ms)

    const checkTelegram = async () => {
      attempts++;

      if (window.Telegram?.WebApp) {
        const tg = window.Telegram.WebApp;

        try {
          tg.ready();
          tg.expand();

          const initData = tg.initData;
          const telegramUser = tg.initDataUnsafe?.user;

          if (telegramUser?.id) {
            const tgId = String(telegramUser.id);

            // Сохранить в localStorage
            localStorage.setItem("telegram_user_id", tgId);
            setTelegramId(tgId);

            // Авторизоваться на сервере
            const response = await fetch("/api/auth/telegram", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                initData,
                user: telegramUser,
              }),
            });

            const data = await response.json();

            if (data.success) {
              setUser(data.user);
              setIsLoading(false);
            } else {
              setError("Ошибка авторизации");
              setIsLoading(false);
            }
          } else {
            // Нет данных пользователя, попробовать localStorage
            const savedId = localStorage.getItem("telegram_user_id");
            if (savedId) {
              setTelegramId(savedId);
              // Проверить на сервере
              const response = await fetch(
                `/api/auth/telegram?telegramId=${savedId}`,
              );
              const data = await response.json();
              if (data.authenticated) {
                setUser(data.user);
              }
            }
            setIsLoading(false);
          }
        } catch (err) {
          console.error("Telegram auth error:", err);
          setError("Ошибка инициализации");
          setIsLoading(false);
        }
      } else if (attempts < maxAttempts) {
        // SDK еще не загружен, ждем
        setTimeout(checkTelegram, 100);
      } else {
        // Превышено время ожидания
        setError(
          "Telegram SDK не загружен. Откройте приложение через Telegram.",
        );
        setIsLoading(false);
      }
    };

    checkTelegram();
  }, []);

  return { telegramId, user, isLoading, error };
}
```

### Использование в компонентах:

```tsx
// app/deposit/page.tsx
import { useTelegramAuth } from "@/hooks/use-telegram-auth";

export default function DepositPage() {
  const { telegramId, user, isLoading, error } = useTelegramAuth();

  if (isLoading) {
    return <div>Загрузка...</div>;
  }

  if (error) {
    return <div>Ошибка: {error}</div>;
  }

  if (!telegramId) {
    return <div>Пожалуйста, откройте через Telegram</div>;
  }

  // Остальной код компонента
}
```

## 📋 ЧЕКЛИСТ ДЛЯ ПРОВЕРКИ

- [x] Telegram WebApp SDK загружается в `<head>`
- [ ] Создан хук `useTelegramAuth` для централизованной авторизации
- [ ] Все компоненты используют хук вместо дублирования кода
- [ ] Добавлена проверка загрузки SDK с таймаутом
- [ ] telegram_id сохраняется в localStorage после авторизации
- [ ] Добавлен fallback UI для ошибок
- [ ] В production обязателен TELEGRAM_BOT_TOKEN
- [ ] Проверяется, что приложение запущено в Telegram

## 🧪 КАК ПРОТЕСТИРОВАТЬ

1. **Открыть через Telegram Bot:**
   - Создать тестового бота через @BotFather
   - Установить Web App URL: `https://moneycas.live`
   - Открыть бота и нажать кнопку запуска

2. **Проверить в DevTools:**

   ```javascript
   // В консоли браузера
   console.log(window.Telegram?.WebApp);
   console.log(window.Telegram?.WebApp?.initDataUnsafe);
   ```

3. **Проверить авторизацию:**
   - Открыть Network tab
   - Найти запрос к `/api/auth/telegram`
   - Проверить, что возвращается `success: true`

4. **Проверить localStorage:**
   ```javascript
   localStorage.getItem("telegram_user_id");
   ```

## 🔐 БЕЗОПАСНОСТЬ

✅ **Что реализовано:**

- Проверка подписи initData через HMAC-SHA256
- Timing-safe сравнение хешей
- Проверка auth_date (защита от replay)
- Валидация структуры данных

⚠️ **Что нужно добавить:**

- Rate limiting для API endpoints
- CSRF защита
- Логирование подозрительных попыток авторизации
