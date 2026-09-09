-- A reliever can work a different agency position on a particular DTR day.
-- The attendance row keeps the source rate and its regular payroll/billing
-- amounts so finalized DTR history remains understandable after rate edits.
ALTER TABLE site_policy
  ADD COLUMN RelieverPositionOverrideEnabled TINYINT(1) NOT NULL DEFAULT 0 AFTER DefaultBreakMinutes;

ALTER TABLE attendance
  ADD COLUMN WorkAgencyPositionID INT NULL AFTER ShiftCodeID,
  ADD COLUMN WorkClientRateID INT NULL AFTER WorkAgencyPositionID,
  ADD COLUMN WorkPositionName VARCHAR(150) NULL AFTER WorkClientRateID,
  ADD COLUMN WorkPayrollRegularRate DECIMAL(12,2) NULL AFTER WorkPositionName,
  ADD COLUMN WorkBillingRegularRate DECIMAL(12,2) NULL AFTER WorkPayrollRegularRate,
  ADD KEY idx_attendance_work_agency_position (WorkAgencyPositionID),
  ADD KEY idx_attendance_work_client_rate (WorkClientRateID),
  ADD CONSTRAINT fk_attendance_work_agency_position FOREIGN KEY (WorkAgencyPositionID) REFERENCES agency_position(AgencyPositionID) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_attendance_work_client_rate FOREIGN KEY (WorkClientRateID) REFERENCES client_rate(ClientRateID) ON DELETE SET NULL ON UPDATE CASCADE;
