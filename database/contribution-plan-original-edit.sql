-- Upgrade an existing date-correction table to audit original amount and cutoff edits.
ALTER TABLE agency_contribution_plan_date_correction
  ADD COLUMN AgencyContributionVersionID INT NULL,
  ADD COLUMN CorrectionKind ENUM('Original','Version') NOT NULL DEFAULT 'Original',
  ADD COLUMN PreviousAmountPerCutoff DECIMAL(10,2) NULL,
  ADD COLUMN NewAmountPerCutoff DECIMAL(10,2) NULL,
  ADD COLUMN PreviousDeductOn ENUM('First','Second','Both') NULL,
  ADD COLUMN NewDeductOn ENUM('First','Second','Both') NULL,
  ADD CONSTRAINT fk_contribution_date_correction_version FOREIGN KEY (AgencyContributionVersionID)
    REFERENCES agency_contribution_plan_version(AgencyContributionVersionID) ON DELETE CASCADE;
