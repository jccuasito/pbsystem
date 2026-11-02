CREATE TABLE IF NOT EXISTS cash_bond_account (
 AccountID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 EmployeeID INT NOT NULL, AgencyID INT NOT NULL, DeductionTypeID INT NOT NULL,
 Balance DECIMAL(14,2) NOT NULL DEFAULT 0,
 Revision INT NOT NULL DEFAULT 1,
 UNIQUE KEY uq_cash_bond_employee_agency (EmployeeID,AgencyID,DeductionTypeID),
 FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID),
 FOREIGN KEY (DeductionTypeID) REFERENCES deduction_type(DeductionTypeID),
 FOREIGN KEY (AgencyID) REFERENCES agency(AgencyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS cash_bond_cutoff_override (
 OverrideID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 EmployeeID INT NOT NULL, AgencyID INT NOT NULL, DeductionTypeID INT NOT NULL,
 PeriodStart DATE NOT NULL, PeriodEnd DATE NOT NULL,
 Amount DECIMAL(12,2) NOT NULL, Reason VARCHAR(500) NOT NULL,
 CreatedBy INT NOT NULL, CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 RemovedBy INT NULL, RemovedAt DATETIME NULL,
 ActiveKey VARCHAR(100) GENERATED ALWAYS AS (CASE WHEN RemovedAt IS NULL THEN CONCAT(EmployeeID,':',AgencyID,':',DeductionTypeID,':',PeriodStart,':',PeriodEnd) ELSE NULL END) STORED,
 UNIQUE KEY uq_cash_bond_cutoff_override (ActiveKey),
 FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID),
 FOREIGN KEY (DeductionTypeID) REFERENCES deduction_type(DeductionTypeID),
 FOREIGN KEY (AgencyID) REFERENCES agency(AgencyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS cash_bond_ledger (
 EntryID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 AccountID INT NOT NULL, PayrollID INT NULL, SourceRefundID INT NULL,
 EntryType ENUM('Collection','Refund','RefundReversal') NOT NULL,
 TransactionDate DATE NOT NULL, PeriodStart DATE NULL, PeriodEnd DATE NULL,
 Amount DECIMAL(12,2) NOT NULL,
 BalanceBefore DECIMAL(14,2) NOT NULL, BalanceAfter DECIMAL(14,2) NOT NULL,
 Reference VARCHAR(150) NOT NULL, Reason VARCHAR(500) NOT NULL,
 RequestKey VARCHAR(64) NULL, RequestHash CHAR(64) NULL,
 Status ENUM('Posted','Voided') NOT NULL DEFAULT 'Posted',
 CreatedBy INT NOT NULL, CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 VoidedBy INT NULL, VoidedAt DATETIME NULL,
 ActiveCollectionKey VARCHAR(120) GENERATED ALWAYS AS (CASE WHEN EntryType='Collection' AND Status='Posted' THEN CONCAT(AccountID,':',PeriodStart,':',PeriodEnd) ELSE NULL END) STORED,
 UNIQUE KEY uq_cash_bond_payroll (PayrollID,AccountID),
 UNIQUE KEY uq_cash_bond_collection_cutoff (ActiveCollectionKey),
 UNIQUE KEY uq_cash_bond_refund_reversal (SourceRefundID),
 UNIQUE KEY uq_cash_bond_request (RequestKey),
 FOREIGN KEY (AccountID) REFERENCES cash_bond_account(AccountID),
 FOREIGN KEY (PayrollID) REFERENCES payroll(PayrollID),
 FOREIGN KEY (SourceRefundID) REFERENCES cash_bond_ledger(EntryID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
