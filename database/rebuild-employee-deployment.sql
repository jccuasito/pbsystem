-- Recovery migration for a missing/corrupt InnoDB employee_deployment tablespace.
-- This recreates the table structure only. It cannot restore the lost deployment rows.
-- SiteShiftID is nullable so an employee may be deployed before a site shift is set up.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS employee_deployment;

CREATE TABLE employee_deployment (
  DeploymentID INT(11) NOT NULL AUTO_INCREMENT,
  EmployeeID INT(11) NOT NULL,
  ClientRateID INT(11) NOT NULL,
  SiteID INT(11) NOT NULL,
  SiteShiftID INT(11) NULL,
  DeploymentType VARCHAR(50) NOT NULL DEFAULT 'Regular',
  StartDate DATE NOT NULL,
  EndDate DATE NULL,
  Remarks TEXT NULL,
  CreatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CreatedBy INT(11) NULL,
  PRIMARY KEY (DeploymentID),
  KEY idx_employee_deployment_employee_dates (EmployeeID, StartDate, EndDate),
  KEY idx_employee_deployment_site_dates (SiteID, StartDate, EndDate),
  KEY idx_employee_deployment_client_rate (ClientRateID),
  KEY idx_employee_deployment_site_shift (SiteShiftID),
  CONSTRAINT fk_deployment_employee
    FOREIGN KEY (EmployeeID) REFERENCES employee (EmployeeID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_deployment_clientrate
    FOREIGN KEY (ClientRateID) REFERENCES client_rate (ClientRateID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_deployment_site
    FOREIGN KEY (SiteID) REFERENCES site (SiteID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_deployment_siteshift
    FOREIGN KEY (SiteShiftID) REFERENCES site_shift (SiteShiftID) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_deployment_createdby
    FOREIGN KEY (CreatedBy) REFERENCES `user` (UserID) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;
