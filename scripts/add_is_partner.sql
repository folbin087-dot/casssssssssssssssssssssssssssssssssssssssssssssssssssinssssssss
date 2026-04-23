-- Add is_partner column to users table if it doesn't exist (MySQL syntax)
SET @exist := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_partner');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE `users` ADD COLUMN `is_partner` TINYINT(1) DEFAULT 0', 'SELECT "Column already exists"');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS `idx_users_is_partner` ON `users`(`is_partner`);
