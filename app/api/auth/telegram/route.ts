import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { query, createUser, getUserByTelegramId, generateUUID, type User } from "@/lib/db"

// Telegram Bot Token for validation
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string | null
  username?: string | null
  language_code?: string
  is_premium?: boolean
}

interface TelegramAuthRequest {
  initData: string
  user: TelegramUser
  referralCode?: string
}

/**
 * Validate Telegram WebApp InitData
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * 
 * InitData format: query string with hash signature
 * Example: user={"id":123,"first_name":"John"}&auth_date=123456789&hash=abc123
 */
function validateTelegramInitData(initData: string): { 
  valid: boolean; 
  data?: Record<string, string>;
  user?: TelegramUser;
  error?: string;
} {
  if (!initData) {
    return { valid: false, error: "Missing initData" }
  }

  // DEV MODE: Skip validation if no bot token (for testing only)
  if (!BOT_TOKEN) {
    console.warn("[Telegram Auth] WARNING: BOT_TOKEN not set, skipping signature validation")
    try {
      const urlParams = new URLSearchParams(initData)
      const userStr = urlParams.get("user")
      if (userStr) {
        const user = JSON.parse(userStr) as TelegramUser
        return { valid: true, data: Object.fromEntries(urlParams), user }
      }
      return { valid: false, error: "Missing user in initData" }
    } catch (e) {
      return { valid: false, error: "Failed to parse initData" }
    }
  }

  try {
    // Parse initData as URLSearchParams
    const urlParams = new URLSearchParams(initData)
    const hash = urlParams.get("hash")

    if (!hash) {
      return { valid: false, error: "Missing hash in initData" }
    }

    // Extract user data
    const userStr = urlParams.get("user")
    if (!userStr) {
      return { valid: false, error: "Missing user in initData" }
    }

    let user: TelegramUser
    try {
      user = JSON.parse(userStr) as TelegramUser
    } catch {
      return { valid: false, error: "Invalid user JSON in initData" }
    }

    // Check auth_date to prevent replay attacks
    const authDate = urlParams.get("auth_date")
    if (!authDate) {
      return { valid: false, error: "Missing auth_date in initData" }
    }

    const authTimestamp = parseInt(authDate) * 1000
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    if (now - authTimestamp > maxAge) {
      return { valid: false, error: "InitData expired (older than 24 hours)" }
    }

    // Build data check string (alphabetically sorted key=value pairs)
    urlParams.delete("hash")
    const dataCheckArr: string[] = []
    
    // Telegram requires keys to be sorted alphabetically
    const sortedKeys = Array.from(urlParams.keys()).sort()
    for (const key of sortedKeys) {
      const value = urlParams.get(key)
      if (value !== null) {
        dataCheckArr.push(`${key}=${value}`)
      }
    }
    
    const dataCheckString = dataCheckArr.join("\n")

    // Calculate secret key: HMAC_SHA256("WebAppData", BOT_TOKEN)
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest()

    // Calculate hash: HMAC_SHA256(secretKey, data_check_string)
    const calculatedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex")

    // Compare hashes using timing-safe comparison
    try {
      const isValid = crypto.timingSafeEqual(
        Buffer.from(hash, "hex"),
        Buffer.from(calculatedHash, "hex")
      )

      if (!isValid) {
        console.error("[Telegram Auth] Hash mismatch:")
        console.error("  Expected:", calculatedHash)
        console.error("  Received:", hash)
        console.error("  Data check string:", dataCheckString)
        return { valid: false, error: "Invalid hash signature" }
      }
    } catch (e) {
      console.error("[Telegram Auth] Error comparing hashes:", e)
      return { valid: false, error: "Hash comparison failed" }
    }

    // Convert URL params to data object
    const data: Record<string, string> = {}
    urlParams.forEach((value, key) => {
      data[key] = value
    })

    console.log("[Telegram Auth] InitData validated successfully for user:", user.id)
    return { valid: true, data, user }
  } catch (error) {
    console.error("[Telegram Auth] InitData validation error:", error)
    return { valid: false, error: "Validation error: " + (error instanceof Error ? error.message : String(error)) }
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: TelegramAuthRequest = await request.json()
    
    // Validate request
    if (!body.user || !body.user.id) {
      return NextResponse.json(
        { success: false, error: "User data required" },
        { status: 400 }
      )
    }
    
    // Validate Telegram InitData
    const validation = validateTelegramInitData(body.initData || "")
    
    if (!validation.valid && BOT_TOKEN) {
      return NextResponse.json(
        { success: false, error: "Invalid authentication data" },
        { status: 401 }
      )
    }
    
    const telegramId = String(body.user.id)
    
    // Check if user exists
    let user = getUserByTelegramId(telegramId)
    
    if (!user) {
      // Create new user with 0 balance
      try {
        const referralCode = body.referralCode
        const firstName = body.user.first_name
        const lastName = body.user.last_name || null
        const username = body.user.username || null

        // Create user with referral handling
        user = createUser({
          telegram_id: telegramId,
          first_name: firstName,
          last_name: lastName,
          username: username,
          referred_by: referralCode || undefined
        })
      } catch (error) {
        console.error("Failed to create user:", error)
        return NextResponse.json(
          { success: false, error: "Failed to create user" },
          { status: 500 }
        )
      }
    } else {
      // Update last activity
      const firstName = body.user.first_name
      const username = body.user.username || null
      query(
        "UPDATE users SET last_activity = datetime('now'), first_name = ?, username = ? WHERE telegram_id = ?",
        [firstName, username, telegramId]
      )
    }
    
    // Check if user is a partner (marked as partner OR has referrals)
    let isPartner = false
    try {
      const partnerResult = query<{ is_partner: number; ref_count: number }>(
        `SELECT
           COALESCE(is_partner, 0) as is_partner,
           (SELECT COUNT(*) FROM users WHERE referred_by = ?) as ref_count
         FROM users WHERE id = ?`,
        [user.referral_code, user.id]
      )
      if (partnerResult.rows.length > 0) {
        isPartner = partnerResult.rows[0].is_partner === 1 || partnerResult.rows[0].ref_count > 0
      }
    } catch (error) {
      console.error("Failed to check partner status:", error)
    }
    
    // Return user data (without sensitive info)
    return NextResponse.json({
      success: true,
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
      isNewUser: !getUserByTelegramId(telegramId),
    })
    
  } catch (error) {
    console.error("Telegram auth error:", error)
    return NextResponse.json(
      { success: false, error: "Authentication failed" },
      { status: 500 }
    )
  }
}

// GET method to check auth status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const telegramId = searchParams.get("telegramId")
  
  if (!telegramId) {
    return NextResponse.json(
      { success: false, error: "Telegram ID required" },
      { status: 400 }
    )
  }
  
  try {
    const user = getUserByTelegramId(telegramId)
    
    if (!user) {
      return NextResponse.json({
        success: false,
        authenticated: false,
      })
    }
    
    // Check if user is a partner (marked as partner OR has referrals)
    let isPartner = false
    try {
      const partnerResult = query<{ is_partner: number; ref_count: number }>(
        `SELECT
           COALESCE(is_partner, 0) as is_partner,
           (SELECT COUNT(*) FROM users WHERE referred_by = ?) as ref_count
         FROM users WHERE id = ?`,
        [user.referral_code, user.id]
      )
      if (partnerResult.rows.length > 0) {
        isPartner = partnerResult.rows[0].is_partner === 1 || partnerResult.rows[0].ref_count > 0
      }
    } catch (error) {
      // Ignore partner check error
    }
    
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
    console.error("Auth check error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to check authentication" },
      { status: 500 }
    )
  }
}
