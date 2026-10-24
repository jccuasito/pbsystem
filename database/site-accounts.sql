-- Site Accounts are independent of agencies. Existing sites remain unassigned.
CREATE TABLE IF NOT EXISTS site_account (
  SiteAccountID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  SiteAccountName VARCHAR(150) NOT NULL,
  Status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_account_name (SiteAccountName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE site
  ADD COLUMN SiteAccountID INT NULL,
  ADD KEY idx_site_account (SiteAccountID),
  ADD CONSTRAINT fk_site_account FOREIGN KEY (SiteAccountID) REFERENCES site_account (SiteAccountID)
    ON DELETE RESTRICT ON UPDATE CASCADE;
