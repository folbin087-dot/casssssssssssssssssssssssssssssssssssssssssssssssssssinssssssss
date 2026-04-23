-- Partner/Affiliate System Tables for MySQL
-- Ensures profitability: partners earn commission ONLY from player losses

-- Add premium partner flag to users if not exists (MySQL syntax)
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_premium_partner');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `users` ADD COLUMN `is_premium_partner` TINYINT(1) DEFAULT 0', 'SELECT "Column already exists"');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Partner earnings tracking table
CREATE TABLE IF NOT EXISTS `partner_earnings` (
  `id` CHAR(36) PRIMARY KEY,
  `partner_id` CHAR(36) NOT NULL,
  `referral_id` CHAR(36),  -- Which referral generated this earning
  `amount` DECIMAL(12, 2) NOT NULL,
  `source_losses` DECIMAL(12, 2) DEFAULT 0,  -- Losses that generated this commission
  `status` ENUM('pending', 'paid', 'cancelled') DEFAULT 'pending',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `paid_at` TIMESTAMP NULL,
  FOREIGN KEY (`partner_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`referral_id`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_partner_earnings_partner` ON `partner_earnings`(`partner_id`);
CREATE INDEX IF NOT EXISTS `idx_partner_earnings_status` ON `partner_earnings`(`status`);
CREATE INDEX IF NOT EXISTS `idx_partner_earnings_created` ON `partner_earnings`(`created_at`);

-- Partner applications for premium status
CREATE TABLE IF NOT EXISTS `partner_applications` (
  `id` CHAR(36) PRIMARY KEY,
  `user_id` CHAR(36) NOT NULL UNIQUE,
  `status` ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  `total_referrals` INT DEFAULT 0,
  `total_volume` DECIMAL(12, 2) DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` TIMESTAMP NULL,
  `reviewed_by` CHAR(36),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
  FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_partner_applications_status` ON `partner_applications`(`status`);

-- Partner link clicks tracking (for conversion analytics)
CREATE TABLE IF NOT EXISTS `partner_clicks` (
  `id` CHAR(36) PRIMARY KEY,
  `partner_id` CHAR(36) NOT NULL,
  `referral_code` VARCHAR(20) NOT NULL,
  `ip_hash` VARCHAR(64),  -- Hashed IP for unique click tracking
  `user_agent` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`partner_id`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS `idx_partner_clicks_partner` ON `partner_clicks`(`partner_id`);
CREATE INDEX IF NOT EXISTS `idx_partner_clicks_created` ON `partner_clicks`(`created_at`);

-- Note: MySQL doesn't support CREATE OR REPLACE for triggers like PostgreSQL
-- Drop existing trigger if exists, then create new one
DROP TRIGGER IF EXISTS `trigger_partner_commission`;

DELIMITER //
CREATE TRIGGER `trigger_partner_commission`
  AFTER INSERT ON `transactions`
  FOR EACH ROW
BEGIN
  DECLARE v_partner_id CHAR(36);
  DECLARE v_is_premium TINYINT(1);
  DECLARE v_commission_rate DECIMAL(4,3);
  DECLARE v_commission DECIMAL(12,2);
  
  -- Only process losing bets (where amount is negative and type is 'bet')
  IF NEW.type = 'bet' AND NEW.amount < 0 THEN
    -- Find the partner who referred this user
    SELECT `referred_by` INTO v_partner_id FROM `users` WHERE `id` = NEW.user_id;
    
    IF v_partner_id IS NOT NULL THEN
      -- Check if partner is premium
      SELECT COALESCE(`is_premium_partner`, 0) INTO v_is_premium
      FROM `users` WHERE `id` = v_partner_id;
      
      -- Set commission rate (5% standard, 8% premium)
      SET v_commission_rate = IF(v_is_premium = 1, 0.08, 0.05);
      
      -- Calculate commission from the loss (amount is negative, so negate it)
      SET v_commission = ABS(NEW.amount) * v_commission_rate;
      
      -- Only record if commission is meaningful
      IF v_commission >= 0.01 THEN
        INSERT INTO `partner_earnings` (`id`, `partner_id`, `referral_id`, `amount`, `source_losses`, `status`)
        VALUES (UUID(), v_partner_id, NEW.user_id, v_commission, ABS(NEW.amount), 'pending');
      END IF;
    END IF;
  END IF;
END//
DELIMITER ;

-- View for partner dashboard stats (MySQL compatible)
-- Note: DATE_SUB is used instead of INTERVAL syntax
CREATE OR REPLACE VIEW `partner_stats` AS
SELECT
  p.`id` as partner_id,
  p.`telegram_id`,
  p.`referral_code`,
  p.`is_premium_partner`,
  COUNT(DISTINCT r.`id`) as total_referrals,
  COUNT(DISTINCT CASE WHEN r.`last_activity` > DATE_SUB(NOW(), INTERVAL 7 DAY) THEN r.`id` END) as active_referrals,
  COALESCE(SUM(r.`total_wagered`), 0) as total_referral_wagered,
  COALESCE(SUM(r.`total_wagered` - r.`total_won`), 0) as total_referral_losses,
  COALESCE((SELECT SUM(`amount`) FROM `partner_earnings` WHERE `partner_id` = p.`id` AND `status` = 'paid'), 0) as total_paid,
  COALESCE((SELECT SUM(`amount`) FROM `partner_earnings` WHERE `partner_id` = p.`id` AND `status` = 'pending'), 0) as pending_earnings
FROM `users` p
LEFT JOIN `users` r ON r.`referred_by` = p.`id`
GROUP BY p.`id`, p.`telegram_id`, p.`referral_code`, p.`is_premium_partner`;
