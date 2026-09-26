-- Final normalized rate ownership:
-- client -> site (ClientID, RegionID) -> site_rate (SiteID, payroll/billing rates).
-- Run once after database/site-specific-rates.sql.

-- This deliberately fails when an old rate still has no site. Assign those
-- records in Site Rates first so the migration never guesses between sites.
ALTER TABLE employee_deployment
  DROP FOREIGN KEY fk_deployment_clientrate;

ALTER TABLE attendance
  DROP FOREIGN KEY fk_attendance_work_client_rate;

ALTER TABLE client_rate
  DROP FOREIGN KEY fk_client_rate_site,
  DROP FOREIGN KEY fk_clientrate_client,
  DROP FOREIGN KEY fk_clientrate_payrollrate,
  DROP FOREIGN KEY fk_clientrate_billingrate;

RENAME TABLE client_rate TO site_rate;

ALTER TABLE site_rate
  DROP INDEX fk_clientrate_client,
  DROP INDEX fk_clientrate_payrollrate,
  DROP INDEX fk_clientrate_billingrate,
  DROP INDEX idx_client_rate_site;

ALTER TABLE site_rate
  CHANGE COLUMN ClientRateID SiteRateID INT(11) NOT NULL AUTO_INCREMENT,
  MODIFY COLUMN SiteID INT(11) NOT NULL,
  DROP COLUMN ClientID,
  ADD KEY idx_site_rate_site (SiteID),
  ADD KEY idx_site_rate_payroll_rate (PayrollRateID),
  ADD KEY idx_site_rate_billing_rate (BillingRateID),
  ADD CONSTRAINT fk_site_rate_site
    FOREIGN KEY (SiteID) REFERENCES site (SiteID)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_site_rate_payroll_rate
    FOREIGN KEY (PayrollRateID) REFERENCES payroll_rate (PayrollRateID)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_site_rate_billing_rate
    FOREIGN KEY (BillingRateID) REFERENCES billing_rate (BillingRateID)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE employee_deployment
  DROP INDEX idx_employee_deployment_client_rate;

ALTER TABLE employee_deployment
  CHANGE COLUMN ClientRateID SiteRateID INT(11) NOT NULL,
  ADD KEY idx_employee_deployment_site_rate (SiteRateID),
  ADD CONSTRAINT fk_deployment_site_rate
    FOREIGN KEY (SiteRateID) REFERENCES site_rate (SiteRateID)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE attendance
  DROP INDEX idx_attendance_work_client_rate;

ALTER TABLE attendance
  CHANGE COLUMN WorkClientRateID WorkSiteRateID INT(11) NULL,
  ADD KEY idx_attendance_work_site_rate (WorkSiteRateID),
  ADD CONSTRAINT fk_attendance_work_site_rate
    FOREIGN KEY (WorkSiteRateID) REFERENCES site_rate (SiteRateID)
    ON DELETE SET NULL ON UPDATE CASCADE;
