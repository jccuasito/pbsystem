-- Aggregate invoice lines have no single employee or site owner.
ALTER TABLE billing_detail MODIFY COLUMN EmployeeID INT NULL, MODIFY COLUMN SiteID INT NULL;

CREATE TABLE IF NOT EXISTS billing_client_profile (
  AgencyID INT NOT NULL, ClientID INT NOT NULL,
  Revision INT NOT NULL DEFAULT 1, ConfigJson LONGTEXT NOT NULL,
  Status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  UpdatedBy INT NULL, UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (AgencyID,ClientID),
  CONSTRAINT fk_billing_profile_agency FOREIGN KEY (AgencyID) REFERENCES agency(AgencyID),
  CONSTRAINT fk_billing_profile_client FOREIGN KEY (ClientID) REFERENCES client(ClientID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_draft (
  BillingID INT NOT NULL PRIMARY KEY, AgencyID INT NOT NULL, ClientID INT NOT NULL,
  PeriodStart DATE NOT NULL, PeriodEnd DATE NOT NULL,
  Revision INT NOT NULL DEFAULT 1, SourceHash CHAR(64) NOT NULL, SnapshotJson LONGTEXT NOT NULL,
  CreatedBy INT NULL, UpdatedBy INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_billing_draft_header FOREIGN KEY (BillingID) REFERENCES billing(BillingID) ON DELETE RESTRICT,
  CONSTRAINT fk_billing_draft_agency FOREIGN KEY (AgencyID) REFERENCES agency(AgencyID),
  CONSTRAINT fk_billing_draft_client FOREIGN KEY (ClientID) REFERENCES client(ClientID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_draft_source (
  BillingID INT NOT NULL, BatchID INT NOT NULL,
  PRIMARY KEY (BillingID,BatchID), UNIQUE KEY uq_billing_source_batch (BatchID),
  CONSTRAINT fk_billing_source_header FOREIGN KEY (BillingID) REFERENCES billing_draft(BillingID) ON DELETE RESTRICT,
  CONSTRAINT fk_billing_source_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr(BatchID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_draft_revision (
  BillingRevisionID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  BillingID INT NOT NULL, Revision INT NOT NULL, SnapshotJson LONGTEXT NOT NULL, ActorUserID INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_billing_revision (BillingID,Revision),
  CONSTRAINT fk_billing_revision_header FOREIGN KEY (BillingID) REFERENCES billing_draft(BillingID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
