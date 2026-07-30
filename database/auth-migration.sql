-- Run this only if the existing `user` table was created before the auth columns in your ERD.
-- All tokens stored by the app are SHA-256 hashes, never the raw token emailed to the user.
ALTER TABLE `user`
  ADD COLUMN IF NOT EXISTS Password VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS AuthProvider ENUM('local','google') NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS GoogleID VARCHAR(255) NULL UNIQUE,
  ADD COLUMN IF NOT EXISTS EmailVerified TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS VerificationToken VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS VerificationTokenExpiry DATETIME NULL,
  ADD COLUMN IF NOT EXISTS ResetPasswordToken VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS ResetPasswordExpiry DATETIME NULL;

CREATE INDEX idx_user_verification_token ON `user` (VerificationToken);
CREATE INDEX idx_user_reset_token ON `user` (ResetPasswordToken);
