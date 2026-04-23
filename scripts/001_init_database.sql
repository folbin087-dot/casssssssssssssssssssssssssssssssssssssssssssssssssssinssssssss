-- MySQL Database Schema for PlaidCas Casino
-- Run this script to initialize the database

-- Note: UUIDs are generated in the application layer
-- MySQL uses CHAR(36) for UUID storage

-- =====================
-- USERS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `users` (
    `id` CHAR(36) PRIMARY KEY,
    `telegram_id` VARCHAR(50) UNIQUE NOT NULL,
    `username` VARCHAR(100),
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(100),
    `balance` DECIMAL(15, 2) DEFAULT 0.00,
    `total_deposited` DECIMAL(15, 2) DEFAULT 0.00,
    `total_withdrawn` DECIMAL(15, 2) DEFAULT 0.00,
    `total_wagered` DECIMAL(15, 2) DEFAULT 0.00,
    `total_won` DECIMAL(15, 2) DEFAULT 0.00,
    `is_banned` TINYINT(1) DEFAULT 0,
    `is_admin` TINYINT(1) DEFAULT 0,
    `is_super_admin` TINYINT(1) DEFAULT 0,
    `is_partner` TINYINT(1) DEFAULT 0,
    `is_premium_partner` TINYINT(1) DEFAULT 0,
    `referral_code` VARCHAR(20) UNIQUE NOT NULL,
    `referred_by` CHAR(36),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `last_activity` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`referred_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index for fast lookup by telegram_id
CREATE INDEX IF NOT EXISTS `idx_users_telegram_id` ON `users`(`telegram_id`);
CREATE INDEX IF NOT EXISTS `idx_users_referral_code` ON `users`(`referral_code`);
CREATE INDEX IF NOT EXISTS `idx_users_is_partner` ON `users`(`is_partner`);

-- =====================
-- TRANSACTIONS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `transactions` (
    `id` CHAR(36) PRIMARY KEY,
    `user_id` CHAR(36) NOT NULL,
    `type` ENUM('deposit', 'withdraw', 'bet', 'win', 'bonus', 'referral') NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `balance_before` DECIMAL(15, 2) NOT NULL,
    `balance_after` DECIMAL(15, 2) NOT NULL,
    `game` VARCHAR(50),
    `metadata` JSON,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indexes for transactions
CREATE INDEX IF NOT EXISTS `idx_transactions_user_id` ON `transactions`(`user_id`);
CREATE INDEX IF NOT EXISTS `idx_transactions_type` ON `transactions`(`type`);
CREATE INDEX IF NOT EXISTS `idx_transactions_created_at` ON `transactions`(`created_at` DESC);

-- =====================
-- PROMO CODES TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `promo_codes` (
    `id` CHAR(36) PRIMARY KEY,
    `code` VARCHAR(50) UNIQUE NOT NULL,
    `bonus_amount` DECIMAL(15, 2) DEFAULT 0.00,
    `bonus_percent` DECIMAL(5, 2) DEFAULT 0.00,
    `max_uses` INT DEFAULT 0, -- 0 = unlimited
    `current_uses` INT DEFAULT 0,
    `min_deposit` DECIMAL(15, 2) DEFAULT 0.00,
    `expires_at` TIMESTAMP NULL,
    `is_active` TINYINT(1) DEFAULT 1,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_promo_codes_code` ON `promo_codes`((UPPER(`code`)));

-- =====================
-- PROMO USES TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `promo_uses` (
    `id` CHAR(36) PRIMARY KEY,
    `promo_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `used_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `unique_promo_use` (`promo_id`, `user_id`),
    FOREIGN KEY (`promo_id`) REFERENCES `promo_codes`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================
-- BONUS CHANNELS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `bonus_channels` (
    `id` CHAR(36) PRIMARY KEY,
    `name` VARCHAR(100) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `type` ENUM('channel', 'group') NOT NULL,
    `reward` DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
    `is_active` TINYINT(1) DEFAULT 1,
    `subscriber_count` INT,
    `claims_count` INT DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================
-- CHANNEL CLAIMS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `channel_claims` (
    `id` CHAR(36) PRIMARY KEY,
    `user_id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `claimed_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY `unique_channel_claim` (`user_id`, `channel_id`),
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`channel_id`) REFERENCES `bonus_channels`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_channel_claims_user_id` ON `channel_claims`(`user_id`);

-- =====================
-- GAME ODDS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `game_odds` (
    `id` CHAR(36) PRIMARY KEY,
    `game` VARCHAR(50) UNIQUE NOT NULL,
    `house_edge` DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `updated_by` CHAR(36),
    FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default odds (ignore duplicates)
INSERT IGNORE INTO `game_odds` (`id`, `game`, `house_edge`) VALUES
    (UUID(), 'aviatrix', 5.00),
    (UUID(), 'plinko', 5.00),
    (UUID(), 'mines', 5.00),
    (UUID(), 'dice', 5.00),
    (UUID(), 'blackjack', 3.00),
    (UUID(), 'roulette', 5.00);

-- =====================
-- SITE SETTINGS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `site_settings` (
    `id` CHAR(36) PRIMARY KEY,
    `key` VARCHAR(100) UNIQUE NOT NULL,
    `value` TEXT NOT NULL,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default settings (ignore duplicates)
INSERT IGNORE INTO `site_settings` (`id`, `key`, `value`) VALUES
    (UUID(), 'telegram_channel', '@plaidcas_official'),
    (UUID(), 'telegram_support', '@plaidcas_support'),
    (UUID(), 'min_deposit', '100'),
    (UUID(), 'max_deposit', '500000'),
    (UUID(), 'min_withdraw', '500'),
    (UUID(), 'max_withdraw', '100000'),
    (UUID(), 'site_name', 'PlaidCas'),
    (UUID(), 'maintenance_mode', 'false');

-- =====================
-- PAYMENTS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `payments` (
    `id` CHAR(36) PRIMARY KEY,
    `user_id` CHAR(36) NOT NULL,
    `order_id` VARCHAR(100) UNIQUE NOT NULL,
    `invoice_id` VARCHAR(100),
    `amount` DECIMAL(15, 2) NOT NULL,
    `amount_crypto` DECIMAL(20, 8),
    `currency` VARCHAR(10) NOT NULL DEFAULT 'RUB',
    `crypto_currency` VARCHAR(10),
    `method` ENUM('sbp', 'ton', 'card') NOT NULL,
    `status` ENUM('pending', 'processing', 'completed', 'failed', 'expired') NOT NULL DEFAULT 'pending',
    `payment_url` TEXT,
    `callback_data` JSON,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `completed_at` TIMESTAMP NULL,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_payments_user_id` ON `payments`(`user_id`);
CREATE INDEX IF NOT EXISTS `idx_payments_order_id` ON `payments`(`order_id`);
CREATE INDEX IF NOT EXISTS `idx_payments_status` ON `payments`(`status`);

-- =====================
-- WITHDRAWAL REQUESTS TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `withdrawal_requests` (
    `id` CHAR(36) PRIMARY KEY,
    `user_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `method` VARCHAR(20) NOT NULL,
    `wallet_address` TEXT,
    `bank_details` JSON,
    `status` ENUM('pending', 'processing', 'completed', 'rejected') NOT NULL DEFAULT 'pending',
    `admin_note` TEXT,
    `processed_by` CHAR(36),
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `processed_at` TIMESTAMP NULL,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`processed_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_withdrawal_requests_user_id` ON `withdrawal_requests`(`user_id`);
CREATE INDEX IF NOT EXISTS `idx_withdrawal_requests_status` ON `withdrawal_requests`(`status`);

-- =====================
-- GAME SESSIONS TABLE (for provably fair)
-- =====================
CREATE TABLE IF NOT EXISTS `game_sessions` (
    `id` CHAR(36) PRIMARY KEY,
    `user_id` CHAR(36) NOT NULL,
    `game` VARCHAR(50) NOT NULL,
    `bet_amount` DECIMAL(15, 2) NOT NULL,
    `win_amount` DECIMAL(15, 2) DEFAULT 0.00,
    `multiplier` DECIMAL(10, 4),
    `result` JSON,
    `server_seed_hash` VARCHAR(64),
    `server_seed` VARCHAR(64),
    `client_seed` VARCHAR(64),
    `nonce` INT,
    `is_revealed` TINYINT(1) DEFAULT 0,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_game_sessions_user_id` ON `game_sessions`(`user_id`);
CREATE INDEX IF NOT EXISTS `idx_game_sessions_game` ON `game_sessions`(`game`);

-- =====================
-- AUDIT LOG TABLE
-- =====================
CREATE TABLE IF NOT EXISTS `audit_log` (
    `id` CHAR(36) PRIMARY KEY,
    `admin_id` CHAR(36),
    `action` VARCHAR(100) NOT NULL,
    `target_type` VARCHAR(50),
    `target_id` CHAR(36),
    `old_value` JSON,
    `new_value` JSON,
    `ip_address` VARCHAR(45), -- IPv4 or IPv6
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`admin_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_audit_log_admin_id` ON `audit_log`(`admin_id`);
CREATE INDEX IF NOT EXISTS `idx_audit_log_created_at` ON `audit_log`(`created_at` DESC);
