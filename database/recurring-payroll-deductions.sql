CREATE TABLE IF NOT EXISTS employee_recurring_deduction (
  RecurringDeductionID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  EmployeeID INT NOT NULL,
  DeductionTypeID INT NOT NULL,
  AmountPerCutoff DECIMAL(10,2) NOT NULL,
  DeductOn ENUM('First','Second','Both') NOT NULL DEFAULT 'Second',
  EffectiveStartDate DATE NOT NULL,
  EffectiveEndDate DATE NULL,
  IsPaused TINYINT(1) NOT NULL DEFAULT 0,
  PauseStartDate DATE NULL,
  ResumeDate DATE NULL,
  PauseReason VARCHAR(255) NULL,
  Status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_recurring_deduction_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID),
  CONSTRAINT fk_recurring_deduction_type FOREIGN KEY (DeductionTypeID) REFERENCES deduction_type(DeductionTypeID),
  KEY idx_recurring_employee_status (EmployeeID, Status, DeductOn, EffectiveStartDate)
);

CREATE TABLE IF NOT EXISTS payroll_deduction_override (
  OverrideID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  BatchID INT NOT NULL,
  EmployeeID INT NOT NULL,
  EntryType ENUM('Loan','Deduction','Recurring') NOT NULL,
  SourceRecordID INT NOT NULL,
  Reason VARCHAR(500) NOT NULL,
  CreatedBy INT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  RemovedBy INT NULL,
  RemovedAt DATETIME NULL,
  CONSTRAINT fk_payroll_deduction_override_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr(BatchID),
  CONSTRAINT fk_payroll_deduction_override_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID),
  CONSTRAINT fk_payroll_deduction_override_creator FOREIGN KEY (CreatedBy) REFERENCES `user`(UserID),
  CONSTRAINT fk_payroll_deduction_override_remover FOREIGN KEY (RemovedBy) REFERENCES `user`(UserID),
  KEY idx_payroll_deduction_override_lookup (BatchID, EmployeeID, EntryType, SourceRecordID, RemovedAt)
);
