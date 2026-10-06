-- One verified missed work date can be carried forward only once, even when
-- its original DTR has no attendance row. Amounts live in adjustment lines.
CREATE TABLE IF NOT EXISTS payroll_adjustment_manual_day (
  ManualDayID INT NOT NULL AUTO_INCREMENT,
  AdjustmentID INT NOT NULL,
  EmployeeID INT NOT NULL,
  SourceBatchID INT NOT NULL,
  SourceDate DATE NOT NULL,
  ShiftCodeID INT NULL,
  RegularHours DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  OTHours DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  OTExtHours DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  NightDiffHours DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  ClaimActive TINYINT NULL DEFAULT 1,
  PRIMARY KEY (ManualDayID),
  UNIQUE KEY uq_adjustment_manual_employee_date (EmployeeID, SourceBatchID, SourceDate, ClaimActive),
  KEY idx_adjustment_manual_header (AdjustmentID),
  CONSTRAINT fk_adjustment_manual_header FOREIGN KEY (AdjustmentID) REFERENCES payroll_adjustment (AdjustmentID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_adjustment_manual_employee FOREIGN KEY (EmployeeID) REFERENCES employee (EmployeeID) ON UPDATE CASCADE,
  CONSTRAINT fk_adjustment_manual_source FOREIGN KEY (SourceBatchID) REFERENCES attendance_dtr (BatchID) ON UPDATE CASCADE,
  CONSTRAINT fk_adjustment_manual_shift FOREIGN KEY (ShiftCodeID) REFERENCES shift_code (ShiftCodeID) ON UPDATE CASCADE,
  CONSTRAINT chk_adjustment_manual_hours CHECK (RegularHours >= 0 AND OTHours >= 0 AND OTExtHours >= 0 AND NightDiffHours >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
