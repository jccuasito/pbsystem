-- Preserve corrections to an unposted plan's original dates, amount, and cutoff.
CREATE TABLE IF NOT EXISTS agency_contribution_plan_date_correction (
  AgencyContributionDateCorrectionID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  AgencyContributionID INT NOT NULL,
  AgencyContributionVersionID INT NULL,
  CorrectionKind ENUM('Original','Version') NOT NULL DEFAULT 'Original',
  PreviousStartDate DATE NOT NULL,
  PreviousEndDate DATE NULL,
  NewStartDate DATE NOT NULL,
  NewEndDate DATE NULL,
  PreviousAmountPerCutoff DECIMAL(10,2) NULL,
  NewAmountPerCutoff DECIMAL(10,2) NULL,
  PreviousDeductOn ENUM('First','Second','Both') NULL,
  NewDeductOn ENUM('First','Second','Both') NULL,
  Reason VARCHAR(500) NOT NULL DEFAULT '',
  CreatedBy INT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contribution_date_correction_plan (AgencyContributionID, CreatedAt),
  CONSTRAINT fk_contribution_date_correction_plan FOREIGN KEY (AgencyContributionID)
    REFERENCES agency_contribution_plan(AgencyContributionID) ON DELETE CASCADE,
  CONSTRAINT fk_contribution_date_correction_version FOREIGN KEY (AgencyContributionVersionID)
    REFERENCES agency_contribution_plan_version(AgencyContributionVersionID) ON DELETE CASCADE,
  CONSTRAINT fk_contribution_date_correction_user FOREIGN KEY (CreatedBy)
    REFERENCES `user`(UserID)
);
