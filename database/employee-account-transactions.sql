ALTER TABLE employee_loan
  ADD COLUMN AccountReference VARCHAR(32) NULL AFTER LoanTypeID,
  ADD UNIQUE KEY uq_employee_loan_account_reference (AccountReference);

ALTER TABLE employee_deduction
  ADD COLUMN AccountReference VARCHAR(32) NULL AFTER DeductionTypeID,
  ADD UNIQUE KEY uq_employee_deduction_account_reference (AccountReference);

UPDATE employee_loan
   SET AccountReference = CONCAT('LN', CASE WHEN LoanID < 1000000 THEN LPAD(LoanID, 6, '0') ELSE CAST(LoanID AS CHAR) END)
 WHERE AccountReference IS NULL;

UPDATE employee_deduction
   SET AccountReference = CONCAT('DED', CASE WHEN EmployeeDeductionID < 1000000 THEN LPAD(EmployeeDeductionID, 6, '0') ELSE CAST(EmployeeDeductionID AS CHAR) END)
 WHERE AccountReference IS NULL;

CREATE TABLE employee_account_transaction (
  TransactionRecordID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  TransactionID VARCHAR(32) NULL,
  EmployeeID INT NULL,
  EmployeeName VARCHAR(255) NOT NULL,
  EmployeeNumber VARCHAR(30) NULL,
  AgencyID INT NULL,
  AgencyName VARCHAR(150) NULL,
  PositionName VARCHAR(150) NULL,
  EntryType ENUM('Loan', 'Deduction') NOT NULL,
  SourceRecordID INT NOT NULL,
  AccountReference VARCHAR(32) NOT NULL,
  IssuanceCode VARCHAR(100) NULL,
  ClassificationName VARCHAR(100) NULL,
  ItemName VARCHAR(150) NOT NULL,
  PayrollID INT NULL,
  TransactionDate DATE NOT NULL,
  CutoffStartDate DATE NULL,
  CutoffEndDate DATE NULL,
  Amount DECIMAL(10,2) NOT NULL,
  BalanceBefore DECIMAL(10,2) NOT NULL,
  BalanceAfter DECIMAL(10,2) NOT NULL,
  Status ENUM('Posted', 'Voided') NOT NULL DEFAULT 'Posted',
  Remarks VARCHAR(255) NULL,
  CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  VoidedAt TIMESTAMP NULL,
  PRIMARY KEY (TransactionRecordID),
  UNIQUE KEY uq_employee_account_transaction_id (TransactionID),
  UNIQUE KEY uq_employee_account_transaction_payroll_source (PayrollID, EntryType, SourceRecordID),
  KEY idx_employee_account_transaction_employee_date (EmployeeID, TransactionDate),
  KEY idx_employee_account_transaction_agency_date (AgencyID, TransactionDate),
  KEY idx_employee_account_transaction_source (EntryType, SourceRecordID, TransactionDate),
  KEY idx_employee_account_transaction_payroll (PayrollID),
  CONSTRAINT fk_employee_account_transaction_employee
    FOREIGN KEY (EmployeeID) REFERENCES employee (EmployeeID)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_employee_account_transaction_payroll
    FOREIGN KEY (PayrollID) REFERENCES payroll (PayrollID)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
