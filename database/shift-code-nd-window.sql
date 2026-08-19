-- Per-shift Night Differential window. No default ND schedule is imposed.
ALTER TABLE shift_code
  ADD COLUMN NDEnabled TINYINT(1) NOT NULL DEFAULT 0 AFTER RegularOTCap,
  ADD COLUMN NDStartTime TIME NULL AFTER NDEnabled,
  ADD COLUMN NDEndTime TIME NULL AFTER NDStartTime;
