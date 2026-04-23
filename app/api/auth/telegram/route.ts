import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { query, createUser, getUserByTelegramId } from "@/lib/db"

// Telegram Bot Token used to validate Mini App initData signatures.
// Production deployments MUST have this set – we refuse unsigned auth below.
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const IS_PRODUCTION = process.env.NODE_ENV === "production"

// Maximum age of initData we accept. Telegram recommends a short window to
// prevent replay. 1 hour is a reasonable balance for a long-lived Mini App
// session since the SDK keeps initData stable for the lifetime of the WebView.
const INIT_DATA_MAX_AGE_MS = 60 * 60 * 1000

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string | null
  username?: string | null
  language_code?: string
  is_premium?: boolean
  photo_url?: string
}

interface TelegramAuthRequest {
  initData?: string
  // Kept for backwards-compat with old clients; ignored when initData validates.
  user?: TelegramUser
  referralCode?: string
}

interface ValidationResult {
  valid: boolean
  user?: TelegramUser
  data?: Record<string, string>
  error?: string
}

/**
 * Validate Telegram WebApp initData per
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Flow:
 *  1. Parse as URLSearchParams, extract & remove `hash`.
 *  2. Build data_check_string: `key=value` lines joined by `\n`, sorted alphabetically.
 *  3. secret_key = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)
 *  4. expected_hash = HMAC_SHA256(key=secret_key, msg=data_check_string)
 *  5. timing-safe compare with the provided hash.
 *  6. Check auth_date freshness.
 */
function validateTelegramInitData(initData: string): ValidationResult {
  if (!initData) {
    return { valid: false, error: "Missing initData" }
  }

  if (!BOT_TOKEN) {
    if (IS_PRODUCTION) {
      return {
        valid: false,
        error: "TELEGRAM_BOT_TOKEN is not configured on the server",
      }
    }
    // Dev-only fallback so local testing without a real bot still works.
    try {
      const urlParams = new URLSearchParams(initData)
      const userStr = urlParams.get("user")
      if (!userStr) return { valid: false, error: "Missing user in initData" }
      const user = JSON.parse(userStr) as TelegramUser
      console.warn(
        "[Telegram Auth] BOT_TOKEN not set – skipping signature validation (dev only)",
      )
      return { valid: true, user, data: Object.fromEntries(urlParams) }
    } catch {
      return { valid: false, error: "Failed to parse initData" }
    }
  }

  try {
    const urlParams = new URLSearchParams(initData)
    const hash = urlParams.get("hash")
    if (!hash) return { valid: false, error: "Missing hash in initData" }

    const userStr = urlParams.get("user")
    if (!userStr) return { valid: false, error: "Missing user in initData" }

    let user: TelegramUser
    try {
      user = JSON.parse(userStr) as TelegramUser
    } catch {
      return { valid: false, error: "Invalid user JSON in initData" }
    }

    const authDate = urlParams.get("auth_date")
    if (!authDate) return { valid: false, error: "Missing auth_date in initData" }

    const authTimestampMs = parseInt(authDate, 10) * 1000
    if (!Number.isFinite(authTimestampMs)) {
      return { valid: false, error: "Invalid auth_date" }
    }
    if (Date.now() - authTimestampMs > INIT_DATA_MAX_AGE_MS) {
      return { valid: false, error: "initData expired" }
    }

    urlParams.delete("hash")
    const sortedKeys = Array.from(urlParams.keys()).sort()
    const dataCheckString = sortedKeys
      .map((k) => `${k}=${urlParams.get(k)}`)
      .join("\n")

    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest()

    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex")

    let hashBuf: Buffer
    let calcBuf: Buffer
    try {
      hashBuf = Buffer.from(hash, "hex")
      calcBuf = Buffer.from(calculatedHash, "hex")
    } catch {
      return { valid: false, error: "Malformed hash" }
    }

    if (
      hashBuf.length !== calcBuf.length ||
      !crypto.timingSafeEqual(hashBuf, calcBuf)
    ) {
      return { valid: false, error: "Invalid hash signature" }
    }

    const data: Record<string, string> = {}
    urlParams.forEach((value, key) => {
      data[key] = value
    })

    return { valid: true, user, data }
  } catch (error) {
    console.error("[Telegram Auth] Validation error:", error)
    return {
      valid: false,
      error:
        "Validation error: " +
        (error instanceof Error ? error.message : String(error)),
    }
  }
}

async function loadIsPartner(userId: string, referralCode: string): Promise<boolean> {
  try {
    const partnerResult = query<{ is_partner: number; ref_count: number }>(
      `SELECT
         COALESCE(is_partner, 0) AS is_partner,
         (SELECT COUNT(*) FROM users WHERE referred_by = ?) AS ref_count
       FROM users WHERE id = ?`,
      [referralCode, userId],
    )
    if (partnerResult.rows.length > 0) {
      const row = partnerResult.rows[0]
      return row.is_partner === 1 || row.ref_count > 0
    }
  } catch (error) {
    console.error("[Telegram Auth] Partner lookup failed:", error)
  }
  return false
}

export async function POST(request: NextRequest) {
  let body: TelegramAuthRequest
  try {
    body = (await request.json()) as TelegramAuthRequest
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    )
  }

  const validation = validateTelegramInitData(body.initData || "")

  if (!validation.valid || !validation.user) {
    return NextResponse.json(
      { success: false, error: validation.error || "Invalid authentication data" },
      { status: 401 },
    )
  }

  // Always trust the signed user from initData – never the free-form
  // body.user, which a client could forge.
  const tgUser = validation.user
  const telegramId = String(tgUser.id)

  try {
    let user = getUserByTelegramId(telegramId)
    const isNewUser = !user

    if (!user) {
      try {
        user = createUser({
          telegram_id: telegramId,
          first_name: tgUser.first_name,
          last_name: tgUser.last_name ?? null,
          username: tgUser.username ?? null,
          referred_by: body.referralCode || undefined,
        })
      } catch (error) {
        console.error("[Telegram Auth] Failed to create user:", error)
        return NextResponse.json(
          { success: false, error: "Failed to create user" },
          { status: 500 },
        )
      }
    } else {
      query(
        "UPDATE users SET last_activity = datetime('now'), first_name = ?, username = ? WHERE telegram_id = ?",
        [tgUser.first_name, tgUser.username ?? null, telegramId],
      )
    }

    const isPartner = await loadIsPartner(user.id, user.referral_code)

    return NextResponse.json({
      success: true,
      isNewUser,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        balance: user.balance,
        referral_code: user.referral_code,
        is_admin: user.is_admin,
        is_banned: user.is_banned,
        is_partner: isPartner,
        created_at: user.created_at,
      },
    })
  } catch (error) {
    console.error("[Telegram Auth] POST error:", error)
    return NextResponse.json(
      { success: false, error: "Authentication failed" },
      { status: 500 },
    )
  }
}

// GET returns basic profile info for a telegramId the caller already knows.
// We treat this as non-sensitive read-only data (public profile fields +
// balance) used for client-side UI refresh. Signed initData is not required
// here to avoid forcing every page to re-submit it, but the response must not
// include anything that can be used to mutate user state. Mutations should
// always go through POST with a signed initData.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")

  if (!telegramId || !/^\d+$/.test(telegramId)) {
    return NextResponse.json(
      { success: false, error: "Telegram ID required" },
      { status: 400 },
    )
  }

  try {
    const user = getUserByTelegramId(telegramId)
    if (!user) {
      return NextResponse.json({ success: false, authenticated: false })
    }

    const isPartner = await loadIsPartner(user.id, user.referral_code)

    return NextResponse.json({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        balance: user.balance,
        referral_code: user.referral_code,
        is_admin: user.is_admin,
        is_partner: isPartner,
      },
    })
  } catch (error) {
    console.error("[Telegram Auth] GET error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to check authentication" },
      { status: 500 },
    )
  }
}
