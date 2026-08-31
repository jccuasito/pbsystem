-- Adds per-duty biometric exceptions so two imported duties on one DTR date
-- can be consolidated accurately into the parent attendance summary.
ALTER TABLE attendance_duty
  ADD COLUMN LateHours DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER NightDiffHours,
  ADD COLUMN UndertimeHours DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER LateHours;
