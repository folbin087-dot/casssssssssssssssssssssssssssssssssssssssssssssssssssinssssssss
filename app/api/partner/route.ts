import { NextRequest, NextResponse } from "next/server"
import { query, withTransaction, getUserByTelegramId, generateUUID } from "@/lib/db"

// Partner commission rate (from losses, not deposits)
// This ensures we never lose money - partners only earn from player losses
const PARTNER_COMMISSION_RATE = 0.05 // 5% of losses
const PREMIUM_PARTNER_COMMISSION = 0.08 // 8% for premium partners

interface ReferralStats {
  total_referrals: number
  active_referrals: number
  total_wagered: number
  total_losses: number
  total_commission_earned: number
  pending_commission: number
  this_week_earnings: number
  this_month_earnings: number
}

interface ReferralUser {
  id: string
  username: string | null
  first_name: string
  joined_at: string
  total_wagered: number
  total_losses: number
  commission_earned: number
  is_active: boolean
  last_activity: string
}

interface DailyStats {
  date: string
  new_referrals: number
  total_wagered: number
  total_losses: number
  commission_earned: number
}

// GET - Fetch partner dashboard data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const telegramId = searchParams.get("telegramId")
    
    if (!telegramId) {
      return NextResponse.json({ success: false, error: "Missing telegramId" }, { status: 400 })
    }
    
    const user = getUserByTelegramId(telegramId)
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 })
    }

    // Check if user is a partner (has any referrals or is marked as partner)
    const isPartner = checkIsPartner(user.id)
    const isPremiumPartner = checkIsPremiumPartner(user.id)

    // Get referral stats
    const stats = getReferralStats(user.id, isPremiumPartner)

    // Get referred users list
    const referrals = getReferredUsers(user.id)

    // Get daily stats for chart (last 30 days)
    const dailyStats = getDailyStats(user.id)

    // Get weekly breakdown
    const weeklyStats = getWeeklyStats(user.id)
    
    // Generate unique partner link
    const partnerLink = `https://t.me/plaid_casino_bot?start=ref_${user.referral_code}`
    
    return NextResponse.json({
      success: true,
      isPartner,
      isPremiumPartner,
      commissionRate: isPremiumPartner ? PREMIUM_PARTNER_COMMISSION : PARTNER_COMMISSION_RATE,
      referralCode: user.referral_code,
      partnerLink,
      stats,
      referrals,
      dailyStats,
      weeklyStats,
    })
  } catch (error) {
    console.error("Partner API error:", error)
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 })
  }
}

// POST - Request withdrawal of commission
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { telegramId, action } = body
    
    if (!telegramId) {
      return NextResponse.json({ success: false, error: "Missing telegramId" }, { status: 400 })
    }
    
    const user = getUserByTelegramId(telegramId)
    if (!user) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 })
    }

    if (action === "withdraw_commission") {
      const result = withdrawCommission(user.id)
      return NextResponse.json(result)
    }

    if (action === "apply_for_premium") {
      // Request premium partner status (requires approval)
      const result = applyForPremiumPartner(user.id)
      return NextResponse.json(result)
    }
    
    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("Partner POST error:", error)
    return NextResponse.json({ success: false, error: "Internal error" }, { status: 500 })
  }
}

// Helper functions
function checkIsPartner(userId: string): boolean {
  // Check if user is marked as partner OR has referrals
  const result = query<{ is_partner: number; ref_count: number }>(
    `SELECT
       COALESCE(is_partner, 0) as is_partner,
       (SELECT COUNT(*) FROM users WHERE referred_by = (SELECT referral_code FROM users WHERE id = ?)) as ref_count
     FROM users WHERE id = ?`,
    [userId, userId]
  )
  if (result.rows.length === 0) return false
  return result.rows[0].is_partner === 1 || result.rows[0].ref_count > 0
}

function checkIsPremiumPartner(userId: string): boolean {
  const result = query<{ is_premium_partner: number }>(
    "SELECT COALESCE(is_premium_partner, 0) as is_premium_partner FROM users WHERE id = ?",
    [userId]
  )
  return result.rows[0]?.is_premium_partner === 1 || false
}

function getReferralStats(userId: string, isPremium: boolean): ReferralStats {
  const commissionRate = isPremium ? PREMIUM_PARTNER_COMMISSION : PARTNER_COMMISSION_RATE

  // Get user referral code first
  const userResult = query<{ referral_code: string }>(
    "SELECT referral_code FROM users WHERE id = ?",
    [userId]
  )
  const referralCode = userResult.rows[0]?.referral_code || userId

  // Get total referrals
  const totalResult = query<{ count: number }>(
    "SELECT COUNT(*) as count FROM users WHERE referred_by = ?",
    [referralCode]
  )

  // Get active referrals (active in last 7 days)
  const activeResult = query<{ count: number }>(
    `SELECT COUNT(*) as count FROM users
     WHERE referred_by = ? AND last_activity > datetime('now', '-7 days')`,
    [referralCode]
  )

  // Get wagered and losses from referrals
  const wagerResult = query<{ total_wagered: number; total_losses: number }>(
    `SELECT
       COALESCE(SUM(u.total_wagered), 0) as total_wagered,
       COALESCE(SUM(u.total_wagered - u.total_won), 0) as total_losses
     FROM users u
     WHERE u.referred_by = ?`,
    [referralCode]
  )

  // Get commission already earned (from partner_earnings table)
  const earnedResult = query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM partner_earnings
     WHERE partner_id = ? AND status = 'paid'`,
    [userId]
  )

  // Get pending commission
  const pendingResult = query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM partner_earnings
     WHERE partner_id = ? AND status = 'pending'`,
    [userId]
  )

  // This week earnings
  const weekResult = query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM partner_earnings
     WHERE partner_id = ? AND created_at > datetime('now', '-7 days')`,
    [userId]
  )

  // This month earnings
  const monthResult = query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM partner_earnings
     WHERE partner_id = ? AND created_at > datetime('now', '-30 days')`,
    [userId]
  )

  const totalLosses = wagerResult.rows[0]?.total_losses || 0

  return {
    total_referrals: totalResult.rows[0].count,
    active_referrals: activeResult.rows[0].count,
    total_wagered: wagerResult.rows[0]?.total_wagered || 0,
    total_losses: totalLosses,
    total_commission_earned: earnedResult.rows[0]?.total || 0,
    pending_commission: Math.max(0, totalLosses * commissionRate - (earnedResult.rows[0]?.total || 0)),
    this_week_earnings: weekResult.rows[0]?.total || 0,
    this_month_earnings: monthResult.rows[0]?.total || 0,
  }
}

function getReferredUsers(userId: string): ReferralUser[] {
  // Get user referral code first
  const userResult = query<{ referral_code: string }>(
    "SELECT referral_code FROM users WHERE id = ?",
    [userId]
  )
  const referralCode = userResult.rows[0]?.referral_code || userId

  const result = query<{
    id: string
    username: string | null
    first_name: string
    created_at: string
    total_wagered: number
    total_won: number
    last_activity: string
  }>(
    `SELECT id, username, first_name, created_at, total_wagered, total_won, last_activity
     FROM users
     WHERE referred_by = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [referralCode]
  )

  return result.rows.map(row => ({
    id: row.id,
    username: row.username,
    first_name: row.first_name,
    joined_at: row.created_at,
    total_wagered: row.total_wagered,
    total_losses: Math.max(0, row.total_wagered - row.total_won),
    commission_earned: Math.max(0, (row.total_wagered - row.total_won) * PARTNER_COMMISSION_RATE),
    is_active: new Date(row.last_activity) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    last_activity: row.last_activity,
  }))
}

function getDailyStats(userId: string): DailyStats[] {
  // Get user referral code first
  const userResult = query<{ referral_code: string }>(
    "SELECT referral_code FROM users WHERE id = ?",
    [userId]
  )
  const referralCode = userResult.rows[0]?.referral_code || userId

  // Get last 30 days of stats
  const result = query<{
    date: string
    new_refs: number
    wagered: number
    losses: number
  }>(
    `SELECT
       date(u.created_at) as date,
       COUNT(*) as new_refs,
       COALESCE(SUM(u.total_wagered), 0) as wagered,
       COALESCE(SUM(u.total_wagered - u.total_won), 0) as losses
     FROM users u
     WHERE u.referred_by = ?
       AND u.created_at > datetime('now', '-30 days')
     GROUP BY date(u.created_at)
     ORDER BY date DESC`,
    [referralCode]
  )

  return result.rows.map(row => ({
    date: row.date,
    new_referrals: row.new_refs,
    total_wagered: row.wagered,
    total_losses: row.losses,
    commission_earned: row.losses * PARTNER_COMMISSION_RATE,
  }))
}

function getWeeklyStats(userId: string) {
  // Get user referral code first
  const userResult = query<{ referral_code: string }>(
    "SELECT referral_code FROM users WHERE id = ?",
    [userId]
  )
  const referralCode = userResult.rows[0]?.referral_code || userId

  const result = query<{
    week: string
    new_refs: number
    wagered: number
    losses: number
  }>(
    `SELECT
       strftime('%Y-%W', u.created_at) as week,
       COUNT(*) as new_refs,
       COALESCE(SUM(u.total_wagered), 0) as wagered,
       COALESCE(SUM(u.total_wagered - u.total_won), 0) as losses
     FROM users u
     WHERE u.referred_by = ?
       AND u.created_at > datetime('now', '-84 days')
     GROUP BY strftime('%Y-%W', u.created_at)
     ORDER BY week DESC`,
    [referralCode]
  )

  return result.rows.map(row => ({
    week: row.week,
    new_referrals: row.new_refs,
    total_wagered: row.wagered,
    total_losses: row.losses,
    commission_earned: row.losses * PARTNER_COMMISSION_RATE,
  }))
}

function withdrawCommission(userId: string): { success: boolean; amount?: number; error?: string } {
  return withTransaction(() => {
    // Get user referral code
    const userResult = query<{ referral_code: string }>(
      "SELECT referral_code FROM users WHERE id = ?",
      [userId]
    )
    const referralCode = userResult.rows[0]?.referral_code || userId

    // Calculate available commission
    const statsResult = query<{ total_wagered: number; total_won: number }>(
      `SELECT
         COALESCE(SUM(u.total_wagered), 0) as total_wagered,
         COALESCE(SUM(u.total_won), 0) as total_won
       FROM users u
       WHERE u.referred_by = ?`,
      [referralCode]
    )

    const paidResult = query<{ total: number }>(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM partner_earnings
       WHERE partner_id = ? AND status = 'paid'`,
      [userId]
    )

    const totalLosses = (statsResult.rows[0]?.total_wagered || 0) - (statsResult.rows[0]?.total_won || 0)
    const totalEarned = Math.max(0, totalLosses * PARTNER_COMMISSION_RATE)
    const alreadyPaid = paidResult.rows[0]?.total || 0
    const available = totalEarned - alreadyPaid

    if (available < 100) {
      return { success: false, error: "Минимальная сумма для вывода: 100 ₽" }
    }

    // Get current balance
    const balanceResult = query<{ balance: number }>(
      'SELECT balance FROM users WHERE id = ?',
      [userId]
    )
    const currentBalance = balanceResult.rows[0]?.balance || 0
    const newBalance = currentBalance + available

    // Record the withdrawal
    const earningId = generateUUID()
    query(
      `INSERT INTO partner_earnings (id, partner_id, amount, status, created_at)
       VALUES (?, ?, ?, 'paid', datetime('now'))`,
      [earningId, userId, available]
    )

    // Add to user balance
    query(
      `UPDATE users SET balance = ? WHERE id = ?`,
      [newBalance, userId]
    )

    // Record transaction
    const transactionId = generateUUID()
    query(
      `INSERT INTO transactions (id, user_id, type, amount, balance_before, balance_after, metadata)
       VALUES (?, ?, 'referral', ?, ?, ?, ?)`,
      [transactionId, userId, available, currentBalance, newBalance, JSON.stringify({type: "partner_withdrawal"})]
    )

    return { success: true, amount: available }
  })
}

function applyForPremiumPartner(userId: string): { success: boolean; message: string } {
  // Check if already applied
  const existing = query(
    `SELECT 1 FROM partner_applications WHERE user_id = ? AND status = 'pending'`,
    [userId]
  )

  if (existing.rows.length > 0) {
    return { success: false, message: "Заявка уже отправлена и ожидает рассмотрения" }
  }

  const applicationId = generateUUID()
  query(
    `INSERT INTO partner_applications (id, user_id, status, created_at)
     VALUES (?, ?, 'pending', datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET status = 'pending', created_at = datetime('now')`,
    [applicationId, userId]
  )

  return { success: true, message: "Заявка на премиум-партнерство отправлена" }
}
