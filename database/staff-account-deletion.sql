-- MariaDB 10.4+ (local XAMPP) and 11.4+ (Namecheap). Safe to rerun.
-- Apply before publishing the account-deletion code. No user rows are deleted.
-- Email is nullable so deletion can release it without a fabricated replacement.
ALTER TABLE `user`
  ADD COLUMN IF NOT EXISTS DeletedAt DATETIME NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS DeletedBy INT NULL DEFAULT NULL,
  MODIFY COLUMN Email VARCHAR(190) NULL;
