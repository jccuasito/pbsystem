ALTER TABLE attendance
  ADD COLUMN ShiftCodeID INT NULL AFTER DeploymentID,
  ADD KEY idx_attendance_shift_code (ShiftCodeID),
  ADD CONSTRAINT fk_attendance_shift_code FOREIGN KEY (ShiftCodeID) REFERENCES shift_code(ShiftCodeID) ON DELETE SET NULL ON UPDATE CASCADE;
