import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

// GET all partners with their aggregated stats from partner_stats view
export async function GET() {
  try {
    // Get all partners with stats
    const result = query<{
      id: string
      telegram_id: string
      username: string | null
      first_name: string
      is_premium_partner: number
      created_at: string
      ref_count: number
      total_earned: number
    }>(
      `SELECT
         u.id, u.telegram_id, u.username, u.first_name, u.is_premium_partner, u.created_at,
         (SELECT COUNT(*) FROM users WHERE referred_by = u.id) as ref_count,
         (SELECT COALESCE(SUM(amount), 0) FROM partner_earnings WHERE partner_id = u.id AND status = 'paid') as total_earned
       FROM users u
       WHERE (u.is_partner = 1 OR u.is_premium_partner = 1)
          OR (SELECT COUNT(*) FROM users WHERE referred_by = u.id) > 0
       ORDER BY ref_count DESC
       LIMIT 100`,
      []
    )

    const partners = result.rows.map(row => ({
      id: row.id,
      telegram_id: row.telegram_id,
      username: row.username,
      first_name: row.first_name,
      is_premium_partner: row.is_premium_partner === 1,
      created_at: row.created_at,
      ref_count: row.ref_count,
      total_earned: row.total_earned,
    }))

    // Aggregate stats
    const totalReferrals = partners.reduce((s, p) => s + p.ref_count, 0)
    const totalPartnerEarnings = partners.reduce((s, p) => s + p.total_earned, 0)
    const pendingPayouts = 0  // Would need additional query to calculate

    const stats = {
      totalPartners: partners.length,
      totalReferrals,
      totalPartnerEarnings,
      pendingPayouts,
      avgReferralsPerPartner: partners.length > 0 ? totalReferrals / partners.length : 0,
    }

    return NextResponse.json({ success: true, partners, stats })
  } catch (error) {
    console.error("Admin partners GET error:", error)
    return NextResponse.json({ success: false, error: "Failed to load partner data" }, { status: 500 })
  }
}

// POST - admin actions on partners (set_premium, add_partner, remove_partner)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, userId, isPremium, telegramId } = body

    if (action === "set_premium") {
      if (!userId) {
        return NextResponse.json({ success: false, error: "Missing userId" }, { status: 400 })
      }
      query(
        "UPDATE users SET is_premium_partner = ? WHERE id = ?",
        [isPremium ? 1 : 0, userId]
      )
      return NextResponse.json({
        success: true,
        message: isPremium ? "Premium статус выдан" : "Premium статус снят",
      })
    }

    if (action === "add_partner") {
      if (!telegramId) {
        return NextResponse.json({ success: false, error: "Введите Telegram ID" }, { status: 400 })
      }
      
      // Check if user exists
      const userResult = query<{ id: string; first_name: string; is_partner: number }>(
        "SELECT id, first_name, COALESCE(is_partner, 0) as is_partner FROM users WHERE telegram_id = ?",
        [telegramId]
      )

      if (userResult.rows.length === 0) {
        return NextResponse.json({ success: false, error: "Пользователь с таким Telegram ID не найден" }, { status: 404 })
      }

      const user = userResult.rows[0]

      if (user.is_partner === 1) {
        return NextResponse.json({ success: false, error: "Пользователь уже является партнером" }, { status: 400 })
      }

      // Mark user as partner
      query(
        "UPDATE users SET is_partner = 1 WHERE id = ?",
        [user.id]
      )
      
      return NextResponse.json({
        success: true,
        message: `Пользователь ${user.first_name} добавлен как партнер`,
      })
    }

    if (action === "remove_partner") {
      if (!userId) {
        return NextResponse.json({ success: false, error: "Missing userId" }, { status: 400 })
      }
      
      // Remove partner status
      query(
        "UPDATE users SET is_partner = 0, is_premium_partner = 0 WHERE id = ?",
        [userId]
      )
      
      return NextResponse.json({
        success: true,
        message: "Партнер удален из программы",
      })
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 })
  } catch (error) {
    console.error("Admin partners POST error:", error)
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 })
  }
}
