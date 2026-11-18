ALTER TABLE employee ADD COLUMN IF NOT EXISTS LastRehireDate DATE NULL AFTER ResignationDate;

CREATE TABLE IF NOT EXISTS employee_rehire (
  RehireID INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  EmployeeID INT NOT NULL,
  PreviousAgencyPositionID INT NOT NULL,
  AgencyPositionID INT NOT NULL,
  PreviousStartDate DATE NULL,
  ResignationDate DATE NOT NULL,
  RehireDate DATE NOT NULL,
  Reason VARCHAR(500) NOT NULL,
  CreatedBy INT NULL,
  CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_rehire_date (EmployeeID, RehireDate),
  CONSTRAINT fk_rehire_employee FOREIGN KEY (EmployeeID) REFERENCES employee(EmployeeID),
  CONSTRAINT fk_rehire_previous_position FOREIGN KEY (PreviousAgencyPositionID) REFERENCES agency_position(AgencyPositionID),
  CONSTRAINT fk_rehire_position FOREIGN KEY (AgencyPositionID) REFERENCES agency_position(AgencyPositionID),
  CONSTRAINT fk_rehire_actor FOREIGN KEY (CreatedBy) REFERENCES `user`(UserID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
