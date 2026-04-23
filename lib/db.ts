// SQLite Database Library with SQL Injection Protection
// Uses better-sqlite3 for synchronous, high-performance operations
// Database stored in ./data/database.sqlite

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'database.sqlite')

// Initialize database
let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema()
  }
  return db
}

// Generate UUID v4
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// Initialize database schema
function initSchema(): void {
  const db = getDb()

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT,
      balance REAL DEFAULT 0,
      total_deposited REAL DEFAULT 0,
      total_withdrawn REAL DEFAULT 0,
      total_wagered REAL DEFAULT 0,
      total_won REAL DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_super_admin INTEGER DEFAULT 0,
      is_partner INTEGER DEFAULT 0,
      referral_code TEXT UNIQUE NOT NULL,
      referred_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (referred_by) REFERENCES users(referral_code)
    )
  `)

  // Transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('deposit', 'withdraw', 'bet', 'win', 'bonus', 'referral')),
      amount REAL NOT NULL,
      balance_before REAL NOT NULL,
      balance_after REAL NOT NULL,
      game TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // Promo codes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      bonus_amount REAL DEFAULT 0,
      bonus_percent REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 0,
      current_uses INTEGER DEFAULT 0,
      min_deposit REAL DEFAULT 0,
      expires_at DATETIME,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Promo uses table
  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_uses (
      id TEXT PRIMARY KEY,
      promo_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (promo_id) REFERENCES promo_codes(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(promo_id, user_id)
    )
  `)

  // Bonus channels table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bonus_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('channel', 'group')),
      reward REAL NOT NULL,
      is_active INTEGER DEFAULT 1,
      subscriber_count INTEGER,
      claims_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Channel claims table
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_claims (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (channel_id) REFERENCES bonus_channels(id),
      UNIQUE(user_id, channel_id)
    )
  `)

  // Game odds table
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_odds (
      id TEXT PRIMARY KEY,
      game TEXT UNIQUE NOT NULL,
      house_edge REAL DEFAULT 5,
      updated_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Site settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Payment methods table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('card', 'wallet', 'crypto')),
      name TEXT NOT NULL,
      details TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // Partner stats table
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_stats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      total_earnings REAL DEFAULT 0,
      pending_earnings REAL DEFAULT 0,
      paid_earnings REAL DEFAULT 0,
      referral_count INTEGER DEFAULT 0,
      conversion_rate REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // Create indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_channel_claims_user_id ON channel_claims(user_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id)')
}

// Type definitions
export interface User {
  id: string
  telegram_id: string
  username: string | null
  first_name: string
  last_name: string | null
  balance: number
  total_deposited: number
  total_withdrawn: number
  total_wagered: number
  total_won: number
  is_banned: boolean
  is_admin: boolean
  is_super_admin: boolean
  is_partner: boolean
  referral_code: string
  referred_by: string | null
  created_at: Date
  last_activity: Date
}

export interface Transaction {
  id: string
  user_id: string
  type: 'deposit' | 'withdraw' | 'bet' | 'win' | 'bonus' | 'referral'
  amount: number
  balance_before: number
  balance_after: number
  game: string | null
  metadata: Record<string, unknown> | null
  created_at: Date
}

export interface PromoCode {
  id: string
  code: string
  bonus_amount: number
  bonus_percent: number
  max_uses: number
  current_uses: number
  min_deposit: number
  expires_at: Date | null
  is_active: boolean
  created_at: Date
}

export interface BonusChannel {
  id: string
  name: string
  username: string
  type: 'channel' | 'group'
  reward: number
  is_active: boolean
  subscriber_count: number | null
  claims_count: number
  created_at: Date
}

export interface GameOdds {
  id: string
  game: string
  house_edge: number
  updated_at: Date
  updated_by: string | null
}

export interface SiteSettings {
  id: string
  key: string
  value: string
  updated_at: Date
}

export interface ChannelClaim {
  id: string
  user_id: string
  channel_id: string
  claimed_at: Date
}

// Helper to convert SQLite row to proper types
function convertUser(row: any): User {
  return {
    ...row,
    is_banned: Boolean(row.is_banned),
    is_admin: Boolean(row.is_admin),
    is_super_admin: Boolean(row.is_super_admin),
    is_partner: Boolean(row.is_partner),
    created_at: new Date(row.created_at),
    last_activity: new Date(row.last_activity)
  }
}

function convertTransaction(row: any): Transaction {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    created_at: new Date(row.created_at)
  }
}

function convertPromoCode(row: any): PromoCode {
  return {
    ...row,
    is_active: Boolean(row.is_active),
    expires_at: row.expires_at ? new Date(row.expires_at) : null,
    created_at: new Date(row.created_at)
  }
}

function convertBonusChannel(row: any): BonusChannel {
  return {
    ...row,
    is_active: Boolean(row.is_active),
    created_at: new Date(row.created_at)
  }
}

// Helper function for safe parameterized queries
export function query<T>(sql: string, params?: unknown[]): { rows: T[]; changes?: number } {
  const db = getDb()
  const stmt = db.prepare(sql)
  
  if (sql.trim().toLowerCase().startsWith('select')) {
    const rows = params ? stmt.all(...params) : stmt.all()
    return { rows: rows as T[] }
  } else {
    const result = params ? stmt.run(...params) : stmt.run()
    return { rows: [], changes: result.changes }
  }
}

// Get single row
export function queryOne<T>(sql: string, params?: unknown[]): T | null {
  const db = getDb()
  const stmt = db.prepare(sql)
  const row = params ? stmt.get(...params) : stmt.get()
  return row ? (row as T) : null
}

// Transaction wrapper for atomic operations
export function withTransaction<T>(callback: () => T): T {
  const db = getDb()
  const transaction = db.transaction(() => {
    return callback()
  })
  return transaction()
}

// =====================
// USER OPERATIONS
// =====================

export function getUserByTelegramId(telegramId: string): User | null {
  const row = queryOne<any>('SELECT * FROM users WHERE telegram_id = ?', [telegramId])
  return row ? convertUser(row) : null
}

export function createUser(data: {
  telegram_id: string
  username: string | null
  first_name: string
  last_name: string | null
  referred_by?: string
}): User {
  const referralCode = generateReferralCode()
  const userId = generateUUID()

  query(
    `INSERT INTO users (id, telegram_id, username, first_name, last_name, referral_code, referred_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, data.telegram_id, data.username, data.first_name, data.last_name, referralCode, data.referred_by || null]
  )

  const row = queryOne<any>('SELECT * FROM users WHERE id = ?', [userId])
  if (!row) throw new Error('Failed to create user')
  return convertUser(row)
}

export function updateUserBalance(
  userId: string,
  amount: number,
  type: Transaction['type'],
  game?: string,
  metadata?: Record<string, unknown>
): User {
  return withTransaction(() => {
    const user = queryOne<any>('SELECT * FROM users WHERE id = ?', [userId])
    if (!user) throw new Error('User not found')

    const newBalance = Math.max(0, user.balance + amount)

    // Update user balance and stats
    const updates: string[] = ['balance = ?', 'last_activity = datetime("now")']
    const values: unknown[] = [newBalance]

    if (type === 'deposit') {
      updates.push('total_deposited = total_deposited + ?')
      values.push(Math.abs(amount))
    } else if (type === 'withdraw') {
      updates.push('total_withdrawn = total_withdrawn + ?')
      values.push(Math.abs(amount))
    } else if (type === 'bet') {
      updates.push('total_wagered = total_wagered + ?')
      values.push(Math.abs(amount))
    } else if (type === 'win') {
      updates.push('total_won = total_won + ?')
      values.push(Math.abs(amount))
    }

    values.push(userId)
    query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values)

    // Create transaction record
    const transactionId = generateUUID()
    query(
      `INSERT INTO transactions (id, user_id, type, amount, balance_before, balance_after, game, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [transactionId, userId, type, amount, user.balance, newBalance, game || null, metadata ? JSON.stringify(metadata) : null]
    )

    return convertUser({ ...user, balance: newBalance })
  })
}

export function getAllUsers(limit = 100, offset = 0): { users: User[], total: number } {
  const countRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users')
  const total = countRow?.count || 0

  const rows = query<any>(
    'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  ).rows

  return { users: rows.map(convertUser), total }
}

export function banUser(userId: string, banned: boolean): void {
  query('UPDATE users SET is_banned = ? WHERE id = ?', [banned ? 1 : 0, userId])
}

export function setAdmin(userId: string, isAdmin: boolean, isSuperAdmin = false): void {
  query(
    'UPDATE users SET is_admin = ?, is_super_admin = ? WHERE id = ?',
    [isAdmin ? 1 : 0, isSuperAdmin ? 1 : 0, userId]
  )
}

export function setPartner(userId: string, isPartner: boolean): void {
  query('UPDATE users SET is_partner = ? WHERE id = ?', [isPartner ? 1 : 0, userId])
}

// =====================
// PROMO CODE OPERATIONS
// =====================

export function getPromoCode(code: string): PromoCode | null {
  const row = queryOne<any>('SELECT * FROM promo_codes WHERE UPPER(code) = UPPER(?)', [code])
  return row ? convertPromoCode(row) : null
}

export function createPromoCode(data: {
  code: string
  bonus_amount?: number
  bonus_percent?: number
  max_uses?: number
  min_deposit?: number
  expires_at?: Date
}): PromoCode {
  const promoId = generateUUID()
  query(
    `INSERT INTO promo_codes (id, code, bonus_amount, bonus_percent, max_uses, min_deposit, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      promoId,
      data.code.toUpperCase(),
      data.bonus_amount || 0,
      data.bonus_percent || 0,
      data.max_uses || 0,
      data.min_deposit || 0,
      data.expires_at ? data.expires_at.toISOString() : null
    ]
  )

  const row = queryOne<any>('SELECT * FROM promo_codes WHERE id = ?', [promoId])
  if (!row) throw new Error('Failed to create promo code')
  return convertPromoCode(row)
}

export function usePromoCode(promoId: string, userId: string): boolean {
  try {
    return withTransaction(() => {
      // Check if already used
      const existing = queryOne('SELECT 1 FROM promo_uses WHERE promo_id = ? AND user_id = ?', [promoId, userId])
      if (existing) return false

      // Increment uses
      query('UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?', [promoId])

      // Record use
      const useId = generateUUID()
      query('INSERT INTO promo_uses (id, promo_id, user_id) VALUES (?, ?, ?)', [useId, promoId, userId])

      return true
    })
  } catch {
    return false
  }
}

export function getAllPromoCodes(): PromoCode[] {
  const rows = query<any>('SELECT * FROM promo_codes ORDER BY created_at DESC').rows
  return rows.map(convertPromoCode)
}

// =====================
// BONUS CHANNEL OPERATIONS
// =====================

export function getBonusChannels(activeOnly = false): BonusChannel[] {
  const whereClause = activeOnly ? 'WHERE is_active = 1' : ''
  const rows = query<any>(`SELECT * FROM bonus_channels ${whereClause} ORDER BY created_at DESC`).rows
  return rows.map(convertBonusChannel)
}

export function createBonusChannel(data: {
  name: string
  username: string
  type: 'channel' | 'group'
  reward: number
}): BonusChannel {
  const channelId = generateUUID()
  query(
    'INSERT INTO bonus_channels (id, name, username, type, reward) VALUES (?, ?, ?, ?, ?)',
    [channelId, data.name, data.username, data.type, data.reward]
  )

  const row = queryOne<any>('SELECT * FROM bonus_channels WHERE id = ?', [channelId])
  if (!row) throw new Error('Failed to create bonus channel')
  return convertBonusChannel(row)
}

export function updateBonusChannel(
  id: string,
  data: Partial<{ name: string; username: string; type: string; reward: number; is_active: boolean }>
): void {
  const updates: string[] = []
  const values: unknown[] = []

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      updates.push(`${key} = ?`)
      values.push(key === 'is_active' ? (value ? 1 : 0) : value)
    }
  })

  if (updates.length === 0) return

  values.push(id)
  query(`UPDATE bonus_channels SET ${updates.join(', ')} WHERE id = ?`, values)
}

export function deleteBonusChannel(id: string): void {
  query('DELETE FROM bonus_channels WHERE id = ?', [id])
}

export function claimChannelBonus(userId: string, channelId: string): boolean {
  try {
    return withTransaction(() => {
      // Check if already claimed
      const existing = queryOne('SELECT 1 FROM channel_claims WHERE user_id = ? AND channel_id = ?', [userId, channelId])
      if (existing) return false

      // Get channel
      const channel = queryOne<any>('SELECT * FROM bonus_channels WHERE id = ? AND is_active = 1', [channelId])
      if (!channel) return false

      // Record claim
      const claimId = generateUUID()
      query('INSERT INTO channel_claims (id, user_id, channel_id) VALUES (?, ?, ?)', [claimId, userId, channelId])

      // Increment claims count
      query('UPDATE bonus_channels SET claims_count = claims_count + 1 WHERE id = ?', [channelId])

      return true
    })
  } catch {
    return false
  }
}

export function getUserChannelClaims(userId: string): string[] {
  const rows = query<{ channel_id: string }>('SELECT channel_id FROM channel_claims WHERE user_id = ?', [userId]).rows
  return rows.map(r => r.channel_id)
}

// =====================
// GAME ODDS OPERATIONS
// =====================

export function getGameOdds(game: string): number {
  const row = queryOne<{ house_edge: number }>('SELECT house_edge FROM game_odds WHERE game = ?', [game])
  return row?.house_edge ?? 5 // Default 5%
}

export function setGameOdds(game: string, houseEdge: number, updatedBy?: string): void {
  const gameId = generateUUID()
  query(
    `INSERT INTO game_odds (id, game, house_edge, updated_by, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(game) DO UPDATE SET house_edge = ?, updated_by = ?, updated_at = datetime('now')`,
    [gameId, game, houseEdge, updatedBy || null, houseEdge, updatedBy || null]
  )
}

export function getAllGameOdds(): Record<string, number> {
  const rows = query<{ game: string; house_edge: number }>('SELECT game, house_edge FROM game_odds').rows
  const odds: Record<string, number> = {}
  rows.forEach(row => {
    odds[row.game] = row.house_edge
  })
  return odds
}

// =====================
// SITE SETTINGS OPERATIONS
// =====================

export function getSetting(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM site_settings WHERE key = ?', [key])
  return row?.value || null
}

export function setSetting(key: string, value: string): void {
  const settingId = generateUUID()
  query(
    `INSERT INTO site_settings (id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
    [settingId, key, value, value]
  )
}

export function getAllSettings(): Record<string, string> {
  const rows = query<{ key: string; value: string }>('SELECT key, value FROM site_settings').rows
  const settings: Record<string, string> = {}
  rows.forEach(row => {
    settings[row.key] = row.value
  })
  return settings
}

// =====================
// STATISTICS
// =====================

export function getStats(): {
  totalUsers: number
  totalDeposits: number
  totalWithdrawals: number
  totalBets: number
  totalWins: number
  profit: number
  activeToday: number
} {
  const users = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users')
  const deposits = queryOne<{ sum: number }>('SELECT COALESCE(SUM(amount), 0) as sum FROM transactions WHERE type = ?', ['deposit'])
  const withdrawals = queryOne<{ sum: number }>('SELECT COALESCE(SUM(amount), 0) as sum FROM transactions WHERE type = ?', ['withdraw'])
  const bets = queryOne<{ sum: number }>('SELECT COALESCE(SUM(ABS(amount)), 0) as sum FROM transactions WHERE type = ?', ['bet'])
  const wins = queryOne<{ sum: number }>('SELECT COALESCE(SUM(amount), 0) as sum FROM transactions WHERE type = ?', ['win'])
  const active = queryOne<{ count: number }>(
    "SELECT COUNT(DISTINCT user_id) as count FROM transactions WHERE created_at > datetime('now', '-24 hours')"
  )

  const totalDeposits = deposits?.sum || 0
  const totalWithdrawals = withdrawals?.sum || 0
  const totalBets = bets?.sum || 0
  const totalWins = wins?.sum || 0

  return {
    totalUsers: users?.count || 0,
    totalDeposits,
    totalWithdrawals,
    totalBets,
    totalWins,
    profit: totalBets - totalWins,
    activeToday: active?.count || 0
  }
}

export function getTransactionLogs(limit = 100, offset = 0): Transaction[] {
  const rows = query<any>('SELECT * FROM transactions ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]).rows
  return rows.map(convertTransaction)
}

// =====================
// HELPERS
// =====================

function generateReferralCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}
