-- Configure a contribution once per agency; posted employee amounts remain in payroll_deduction.
CREATE TABLE IF NOT EXISTS agency_contribution_plan (
  AgencyContributionID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  AgencyID INT NOT NULL,
  DeductionTypeID INT NOT NULL,
  AmountPerCutoff DECIMAL(10,2) NOT NULL,
  DeductOn ENUM('First','Second','Both') NOT NULL DEFAULT 'Second',
  EffectiveStartDate DATE NOT NULL,
  EffectiveEndDate DATE NULL,
  Status ENUM('Active','Inactive') NOT NULL DEFAULT 'Active',
  CreatedBy INT NOT NULL,
  UpdatedBy INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_agency_contribution_agency FOREIGN KEY (AgencyID) REFERENCES agency(AgencyID),
  CONSTRAINT fk_agency_contribution_type FOREIGN KEY (DeductionTypeID) REFERENCES deduction_type(DeductionTypeID),
  CONSTRAINT fk_agency_contribution_creator FOREIGN KEY (CreatedBy) REFERENCES `user`(UserID),
  CONSTRAINT fk_agency_contribution_updater FOREIGN KEY (UpdatedBy) REFERENCES `user`(UserID),
  KEY idx_agency_contribution_due (AgencyID, Status, DeductOn, EffectiveStartDate)
);

ALTER TABLE payroll_deduction_override
  MODIFY EntryType ENUM('Loan','Deduction','Recurring','AgencyContribution') NOT NULL;
