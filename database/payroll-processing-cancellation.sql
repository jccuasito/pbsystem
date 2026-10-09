ALTER TABLE payroll
  MODIFY COLUMN Status ENUM('Draft', 'For Approval', 'Approved', 'Released', 'Cancelled') DEFAULT 'Draft';

ALTER TABLE payroll_processing_review
  MODIFY COLUMN ReviewStatus ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending';

ALTER TABLE dtr_workflow_event
  MODIFY COLUMN Action ENUM('Compute Payroll', 'Compute Billing', 'Approve Payroll', 'Reject Payroll', 'Cancel Payroll') NOT NULL;

ALTER TABLE payroll_adjustment
  MODIFY COLUMN Status ENUM('Draft', 'For Approval', 'Approved', 'Ready for Payroll', 'Applied', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Draft',
  ADD COLUMN PreAppliedStatus ENUM('Approved', 'Ready for Payroll') NULL;

ALTER TABLE payroll_processing_posting
  ADD COLUMN Status ENUM('Active', 'Cancelled') NOT NULL DEFAULT 'Active',
  ADD COLUMN CancelledBy INT NULL,
  ADD COLUMN CancelledAt DATETIME NULL,
  DROP PRIMARY KEY,
  ADD COLUMN PostingID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST,
  ADD COLUMN ActiveEmployeeID INT GENERATED ALWAYS AS (CASE WHEN Status = 'Active' THEN EmployeeID ELSE NULL END) PERSISTENT,
  ADD UNIQUE KEY uq_payroll_processing_posting_active (BatchID, ActiveEmployeeID),
  ADD KEY idx_payroll_processing_posting_batch_status (BatchID, Status);
