-- Extends the existing annual benefit; does not seed employee amounts or payments.
ALTER TABLE thirteenth_month_pay
  ADD COLUMN IF NOT EXISTS AgencyID INT NULL,
  ADD COLUMN IF NOT EXISTS CoverageStart DATE NULL,
  ADD COLUMN IF NOT EXISTS CoverageEnd DATE NULL,
  ADD COLUMN IF NOT EXISTS SourceHash CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS SnapshotJson LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS Revision INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ReviewNote VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS EligibilityConfirmed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ApprovedBy INT NULL,
  ADD COLUMN IF NOT EXISTS ApprovedAt DATETIME NULL,
  ADD COLUMN IF NOT EXISTS UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS thirteenth_month_earning (
  EarningID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  EmployeeID INT NOT NULL,
  AgencyID INT NOT NULL,
  PayYear YEAR NOT NULL,
  PeriodStart DATE NOT NULL,
  PeriodEnd DATE NOT NULL,
  BasicEarned DECIMAL(12,2) NOT NULL,
  Reference VARCHAR(150) NOT NULL,
  Reason VARCHAR(1000) NOT NULL,
  EntryKind ENUM('Previous earnings','Basic adjustment') NOT NULL DEFAULT 'Previous earnings',
  Status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  CreatedBy INT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  RemovedBy INT NULL,
  RemovedAt DATETIME NULL,
  RemovalReason VARCHAR(1000) NULL,
  KEY ix_thirteenth_earning_year(EmployeeID,AgencyID,PayYear,Status),
  CONSTRAINT fk_thirteenth_earning_employee FOREIGN KEY(EmployeeID) REFERENCES employee(EmployeeID),
  CONSTRAINT fk_thirteenth_earning_agency FOREIGN KEY(AgencyID) REFERENCES agency(AgencyID),
  CONSTRAINT fk_thirteenth_earning_actor FOREIGN KEY(CreatedBy) REFERENCES `user`(UserID)
);

CREATE TABLE IF NOT EXISTS thirteenth_month_release (
  ReleaseID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ThirteenthMonthID INT NOT NULL,
  Amount DECIMAL(12,2) NOT NULL,
  Withholding DECIMAL(12,2) NOT NULL DEFAULT 0,
  NetAmount DECIMAL(12,2) NOT NULL,
  PaymentDate DATE NOT NULL,
  Reference VARCHAR(150) NOT NULL,
  Reason VARCHAR(1000) NOT NULL,
  EntryKind ENUM('Release','Previous payment') NOT NULL DEFAULT 'Release',
  Status ENUM('Active','Voided') NOT NULL DEFAULT 'Active',
  CreatedBy INT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  VoidedBy INT NULL,
  VoidedAt DATETIME NULL,
  VoidReason VARCHAR(1000) NULL,
  UNIQUE KEY uq_thirteenth_release_reference(ThirteenthMonthID,Reference),
  CONSTRAINT fk_thirteenth_release_header FOREIGN KEY(ThirteenthMonthID) REFERENCES thirteenth_month_pay(ThirteenthMonthID),
  CONSTRAINT fk_thirteenth_release_actor FOREIGN KEY(CreatedBy) REFERENCES `user`(UserID)
);

CREATE TABLE IF NOT EXISTS thirteenth_month_review (
  AdjustmentLineID INT NOT NULL PRIMARY KEY,
  IncludedInBasic TINYINT(1) NOT NULL,
  EarnedDate DATE NOT NULL,
  Reason VARCHAR(1000) NOT NULL,
  ReviewedBy INT NOT NULL,
  ReviewedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_thirteenth_review_adjustment FOREIGN KEY(AdjustmentLineID) REFERENCES payroll_adjustment_line(AdjustmentLineID),
  CONSTRAINT fk_thirteenth_review_actor FOREIGN KEY(ReviewedBy) REFERENCES `user`(UserID)
);

CREATE TABLE IF NOT EXISTS thirteenth_month_event (
  EventID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ThirteenthMonthID INT NOT NULL,
  Action VARCHAR(50) NOT NULL,
  ActorID INT NOT NULL,
  Reason VARCHAR(1000) NOT NULL,
  SnapshotJson LONGTEXT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_thirteenth_event_header FOREIGN KEY(ThirteenthMonthID) REFERENCES thirteenth_month_pay(ThirteenthMonthID),
  CONSTRAINT fk_thirteenth_event_actor FOREIGN KEY(ActorID) REFERENCES `user`(UserID)
);
