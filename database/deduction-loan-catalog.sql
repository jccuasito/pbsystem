CREATE TABLE deduction_loan_classification (
  ClassificationID INT NOT NULL AUTO_INCREMENT,
  ClassificationName VARCHAR(100) NOT NULL,
  AppliesTo ENUM('Loan', 'Deduction') NOT NULL DEFAULT 'Loan',
  Description VARCHAR(255) NULL,
  Status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
  CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ClassificationID),
  UNIQUE KEY uq_deduction_loan_classification_name (ClassificationName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE loan_type
  ADD COLUMN ClassificationID INT NULL AFTER LoanName,
  ADD COLUMN Description VARCHAR(255) NULL AFTER GovernmentAgency,
  ADD UNIQUE KEY uq_loan_type_classification_name (ClassificationID, LoanName),
  ADD KEY idx_loan_type_classification (ClassificationID),
  ADD CONSTRAINT fk_loan_type_classification
    FOREIGN KEY (ClassificationID) REFERENCES deduction_loan_classification (ClassificationID)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE deduction_type
  ADD COLUMN ClassificationID INT NULL AFTER DeductionName,
  ADD COLUMN Description VARCHAR(255) NULL AFTER DeductionPeriod,
  ADD UNIQUE KEY uq_deduction_type_classification_name (ClassificationID, DeductionName),
  ADD KEY idx_deduction_type_classification (ClassificationID),
  ADD CONSTRAINT fk_deduction_type_classification
    FOREIGN KEY (ClassificationID) REFERENCES deduction_loan_classification (ClassificationID)
    ON DELETE RESTRICT ON UPDATE CASCADE;

