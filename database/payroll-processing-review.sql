CREATE TABLE IF NOT EXISTS payroll_processing_review (
  BatchID INT NOT NULL PRIMARY KEY,
  ReviewStatus ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  SnapshotJson LONGTEXT NULL,
  ApprovedBy INT NULL,
  ApprovedAt DATETIME NULL,
  RejectedBy INT NULL,
  RejectedAt DATETIME NULL,
  RejectionReason VARCHAR(500) NULL,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payroll_processing_review_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr (BatchID) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS dtr_workflow_event (
  EventID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  BatchID INT NOT NULL,
  Action ENUM('Compute Payroll', 'Compute Billing', 'Approve Payroll', 'Reject Payroll') NOT NULL,
  PreviousDtrStatus VARCHAR(40) NOT NULL,
  NextDtrStatus VARCHAR(40) NOT NULL,
  ActorUserID INT NULL,
  ActorName VARCHAR(220) NOT NULL,
  ActorRole VARCHAR(80) NULL,
  ActorDepartment VARCHAR(150) NULL,
  Reason VARCHAR(500) NULL,
  SnapshotJson LONGTEXT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_dtr_workflow_event_batch (BatchID, EventID),
  CONSTRAINT fk_dtr_workflow_event_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr (BatchID) ON DELETE RESTRICT
);
