ALTER TABLE deduction_loan_classification MODIFY AppliesTo ENUM('Loan','Deduction','Contribution','Recurring Deduction') NOT NULL DEFAULT 'Loan';
