-- Contribution uses deduction_type and the existing payroll deduction posting path.
-- The name is unique within each type, so Loan and Contribution may both have SSS.
ALTER TABLE deduction_loan_classification
  MODIFY AppliesTo ENUM('Loan', 'Deduction', 'Contribution') NOT NULL DEFAULT 'Loan';

ALTER TABLE deduction_loan_classification
  DROP INDEX uq_deduction_loan_classification_name,
  ADD UNIQUE KEY uq_deduction_loan_classification_scope_name (AppliesTo, ClassificationName);
