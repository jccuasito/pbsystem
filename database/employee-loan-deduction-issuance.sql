ALTER TABLE employee_loan
  ADD COLUMN IssuanceCode VARCHAR(100) NULL AFTER LoanTypeID,
  ADD COLUMN RepaymentStartDate DATE NULL AFTER ReleaseDate,
  ADD COLUMN RepaymentMonths SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER RepaymentStartDate,
  ADD COLUMN RepaymentCutoff ENUM('First','Second') NOT NULL DEFAULT 'Second' AFTER RepaymentMonths,
  ADD COLUMN FinalInstallmentAmount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER MonthlyDeduction,
  ADD COLUMN IsPaused TINYINT(1) NOT NULL DEFAULT 0 AFTER EndDate,
  ADD COLUMN PauseStartDate DATE NULL AFTER IsPaused,
  ADD COLUMN ResumeDate DATE NULL AFTER PauseStartDate,
  ADD COLUMN PauseReason VARCHAR(255) NULL AFTER ResumeDate,
  ADD COLUMN Remarks VARCHAR(255) NULL AFTER PauseReason,
  ADD COLUMN CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD UNIQUE KEY uq_employee_loan_issuance_code (IssuanceCode),
  ADD KEY idx_employee_loan_repayment_queue (EmployeeID, Status, RepaymentCutoff, RepaymentStartDate, ReleaseDate);

ALTER TABLE employee_deduction
  ADD COLUMN IssuanceCode VARCHAR(100) NULL AFTER DeductionTypeID,
  ADD COLUMN IssuanceDate DATE NULL AFTER IssuanceCode,
  ADD COLUMN RemainingBalance DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER Amount,
  ADD COLUMN InstallmentAmount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER RemainingBalance,
  ADD COLUMN FinalInstallmentAmount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER InstallmentAmount,
  ADD COLUMN RepaymentStartDate DATE NULL AFTER StartDate,
  ADD COLUMN RepaymentMonths SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER RepaymentStartDate,
  ADD COLUMN RepaymentCutoff ENUM('First','Second') NOT NULL DEFAULT 'First' AFTER RepaymentMonths,
  ADD COLUMN IsPaused TINYINT(1) NOT NULL DEFAULT 0 AFTER EndDate,
  ADD COLUMN PauseStartDate DATE NULL AFTER IsPaused,
  ADD COLUMN ResumeDate DATE NULL AFTER PauseStartDate,
  ADD COLUMN PauseReason VARCHAR(255) NULL AFTER ResumeDate,
  ADD COLUMN CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD UNIQUE KEY uq_employee_deduction_issuance_code (IssuanceCode),
  ADD KEY idx_employee_deduction_repayment_queue (EmployeeID, Status, RepaymentCutoff, RepaymentStartDate, IssuanceDate);

UPDATE employee_deduction
   SET IssuanceDate = StartDate
 WHERE IssuanceDate IS NULL
   AND StartDate IS NOT NULL;

UPDATE employee_loan
   SET RepaymentStartDate = COALESCE(RepaymentStartDate, ReleaseDate),
       RepaymentMonths = GREATEST(1, RepaymentMonths),
       EndDate = COALESCE(EndDate, LAST_DAY(COALESCE(RepaymentStartDate, ReleaseDate))),
       MonthlyDeduction = CASE WHEN MonthlyDeduction > 0 THEN MonthlyDeduction ELSE LoanAmount END,
       FinalInstallmentAmount = CASE WHEN FinalInstallmentAmount > 0 THEN FinalInstallmentAmount ELSE LoanAmount END;

UPDATE employee_deduction
   SET RepaymentStartDate = COALESCE(RepaymentStartDate, StartDate, IssuanceDate),
       RepaymentMonths = GREATEST(1, RepaymentMonths),
       EndDate = COALESCE(EndDate,
         CASE WHEN RepaymentCutoff = 'First'
           THEN DATE_ADD(DATE_FORMAT(DATE_ADD(COALESCE(RepaymentStartDate, StartDate, IssuanceDate), INTERVAL IF(DAY(COALESCE(RepaymentStartDate, StartDate, IssuanceDate)) > 15, 1, 0) MONTH), '%Y-%m-01'), INTERVAL 14 DAY)
           ELSE LAST_DAY(COALESCE(RepaymentStartDate, StartDate, IssuanceDate))
         END),
       RemainingBalance = CASE WHEN Status = 'Completed' THEN 0 ELSE Amount END,
       InstallmentAmount = CASE WHEN InstallmentAmount > 0 THEN InstallmentAmount ELSE Amount END,
       FinalInstallmentAmount = CASE WHEN FinalInstallmentAmount > 0 THEN FinalInstallmentAmount ELSE Amount END;
