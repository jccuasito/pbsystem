CREATE TABLE IF NOT EXISTS employee_information_request (
 RequestID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 EmployeeID INT NOT NULL, AccountID INT NOT NULL,
 FieldKey VARCHAR(60) NOT NULL, FieldLabel VARCHAR(100) NOT NULL,
 RecordedValue TEXT NULL, ProposedValue TEXT NOT NULL, Message TEXT NOT NULL,
 Status ENUM('Pending','In review','Resolved','Declined','Cancelled') NOT NULL DEFAULT 'Pending',
 Version INT NOT NULL DEFAULT 1,
 CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY idx_information_employee(EmployeeID,RequestID), KEY idx_information_status(Status,RequestID),
 CONSTRAINT fk_information_employee FOREIGN KEY(EmployeeID) REFERENCES employee(EmployeeID) ON DELETE RESTRICT,
 CONSTRAINT fk_information_account FOREIGN KEY(AccountID) REFERENCES employee_portal_account(AccountID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS employee_information_message (
 MessageID INT NOT NULL AUTO_INCREMENT PRIMARY KEY, RequestID INT NOT NULL,
 Sender ENUM('Employee','Staff') NOT NULL, ActorUserID INT NULL, Message TEXT NOT NULL,
 Status VARCHAR(20) NULL, CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_information_message(RequestID,MessageID),
 CONSTRAINT fk_information_message FOREIGN KEY(RequestID) REFERENCES employee_information_request(RequestID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS payslip_archive (
 ArchiveID INT NOT NULL AUTO_INCREMENT PRIMARY KEY, EmployeeID INT NOT NULL,
 SiteID INT NULL, AgencyID INT NULL,
 PeriodStart DATE NOT NULL, PeriodEnd DATE NOT NULL, AgencyName VARCHAR(200) NULL,
 SiteLabel VARCHAR(255) NULL, Notes VARCHAR(1000) NULL,
 FilePath VARCHAR(80) NOT NULL, FileName VARCHAR(255) NOT NULL, FileSHA256 CHAR(64) NOT NULL,
 FileSize INT NOT NULL, PageCount INT NOT NULL,
 Status ENUM('Draft','Posted','Withdrawn','Removed') NOT NULL DEFAULT 'Draft',
 UploadedBy INT NOT NULL, PostedAt DATETIME NULL,
 CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_archive_file(EmployeeID,PeriodStart,PeriodEnd,FileSHA256),
 KEY idx_archive_employee(EmployeeID,Status,PeriodEnd),
 KEY idx_archive_site_cutoff(SiteID,AgencyID,PeriodStart,PeriodEnd),
 CONSTRAINT fk_archive_employee FOREIGN KEY(EmployeeID) REFERENCES employee(EmployeeID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS payslip_archive_event (
 EventID INT NOT NULL AUTO_INCREMENT PRIMARY KEY, ArchiveID INT NOT NULL,
 Action VARCHAR(30) NOT NULL, ActorUserID INT NOT NULL,
 CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_archive_event(ArchiveID,EventID),
 CONSTRAINT fk_archive_event FOREIGN KEY(ArchiveID) REFERENCES payslip_archive(ArchiveID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
