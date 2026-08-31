-- Flexible shifts such as AUGMENTATION use biometric Date/Time In and Out,
-- so they do not need a default schedule on the shift code itself.
ALTER TABLE shift_code
  MODIFY COLUMN TimeIn TIME NULL,
  MODIFY COLUMN TimeOut TIME NULL;

-- One DTR calendar day remains one attendance summary.  The child records keep
-- every actual duty/biometric segment, including a second augmentation shift on
-- the same day, so it can never overwrite the first duty.
CREATE TABLE IF NOT EXISTS attendance_duty (
  AttendanceDutyID INT NOT NULL AUTO_INCREMENT,
  AttendanceID INT NOT NULL,
  ShiftCodeID INT NULL,
  SourceRowNumber INT NULL,
  TimeIn DATETIME NULL,
  TimeOut DATETIME NULL,
  RegularHours DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  OTHours DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  OTExtHours DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  NightDiffHours DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  CreatedBy INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedBy INT NULL,
  UpdatedAt DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (AttendanceDutyID),
  UNIQUE KEY uq_attendance_duty_source (AttendanceID, SourceRowNumber),
  KEY idx_attendance_duty_shift (ShiftCodeID),
  CONSTRAINT fk_attendance_duty_attendance FOREIGN KEY (AttendanceID) REFERENCES attendance(AttendanceID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_attendance_duty_shift FOREIGN KEY (ShiftCodeID) REFERENCES shift_code(ShiftCodeID) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_attendance_duty_createdby FOREIGN KEY (CreatedBy) REFERENCES user(UserID) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_attendance_duty_updatedby FOREIGN KEY (UpdatedBy) REFERENCES user(UserID) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
