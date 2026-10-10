-- Dated contribution amounts/cutoffs are immutable snapshots, like rate versions.
-- The parent plan retains its original amount and start/end dates.
CREATE TABLE IF NOT EXISTS agency_contribution_plan_version (
  AgencyContributionVersionID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  AgencyContributionID INT NOT NULL,
  EffectiveDate DATE NOT NULL,
  AmountPerCutoff DECIMAL(10,2) NOT NULL,
  DeductOn ENUM('First','Second','Both') NOT NULL,
  Reason VARCHAR(500) NOT NULL DEFAULT '',
  CreatedBy INT NOT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contribution_version_date (AgencyContributionID, EffectiveDate, AgencyContributionVersionID),
  CONSTRAINT fk_contribution_version_plan FOREIGN KEY (AgencyContributionID)
    REFERENCES agency_contribution_plan(AgencyContributionID) ON DELETE CASCADE,
  CONSTRAINT fk_contribution_version_user FOREIGN KEY (CreatedBy)
    REFERENCES `user`(UserID)
);
