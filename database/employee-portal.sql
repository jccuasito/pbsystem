CREATE TABLE IF NOT EXISTS employee_portal_account (
  AccountID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  EmployeeID INT NOT NULL,
  Email VARCHAR(190) NOT NULL,
  ContactNumber VARCHAR(30) NOT NULL,
  PasswordHash VARCHAR(255) NOT NULL,
  MatchedGovernmentID INT NULL,
  ResetTokenHash CHAR(64) NULL,
  ResetExpiresAt DATETIME NULL,
  Status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  AgreementVersion VARCHAR(40) NOT NULL,
  AgreementText LONGTEXT NULL,
  AgreementAcceptedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_portal_employee (EmployeeID),
  UNIQUE KEY uq_portal_email (Email),
  CONSTRAINT fk_portal_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_portal_session (
  TokenHash CHAR(64) NOT NULL PRIMARY KEY,
  AccountID INT NOT NULL,
  ExpiresAt DATETIME NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_portal_session_account (AccountID),
  KEY idx_portal_session_expiry (ExpiresAt),
  CONSTRAINT fk_portal_session_account FOREIGN KEY (AccountID) REFERENCES employee_portal_account(AccountID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_portal_attempt (
  LimitKey CHAR(64) NOT NULL,
  WindowStart BIGINT NOT NULL,
  Attempts INT NOT NULL DEFAULT 1,
  PRIMARY KEY (LimitKey,WindowStart)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_portal_event (
  EventID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  AccountID INT NOT NULL,
  Action VARCHAR(40) NOT NULL,
  ActorUserID INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_portal_event_account (AccountID),
  CONSTRAINT fk_portal_event_account FOREIGN KEY (AccountID) REFERENCES employee_portal_account(AccountID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payslip_publication (
  PublicationID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  EmployeeID INT NOT NULL,
  GroupKey VARCHAR(150) NOT NULL,
  Status ENUM('Posted','Withdrawn') NOT NULL DEFAULT 'Posted',
  SnapshotJson LONGTEXT NOT NULL,
  PostedBy INT NOT NULL,
  PostedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  WithdrawnBy INT NULL,
  WithdrawnAt DATETIME NULL,
  UNIQUE KEY uq_payslip_employee_group (EmployeeID,GroupKey),
  CONSTRAINT fk_publication_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payslip_publication_source (
  PublicationID INT NOT NULL,
  PayrollID INT NOT NULL,
  PRIMARY KEY(PublicationID,PayrollID),
  CONSTRAINT fk_publication_source FOREIGN KEY (PublicationID) REFERENCES payslip_publication(PublicationID) ON DELETE CASCADE,
  CONSTRAINT fk_publication_payroll FOREIGN KEY (PayrollID) REFERENCES payroll(PayrollID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payslip_publication_event (
  EventID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  PublicationID INT NOT NULL,
  Action ENUM('Posted','Withdrawn') NOT NULL,
  SnapshotJson LONGTEXT NOT NULL,
  ActorUserID INT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_publication_event (PublicationID),
  CONSTRAINT fk_publication_event FOREIGN KEY (PublicationID) REFERENCES payslip_publication(PublicationID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
