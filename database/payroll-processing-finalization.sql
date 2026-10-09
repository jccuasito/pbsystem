CREATE TABLE IF NOT EXISTS payroll_processing_posting (
  BatchID INT NOT NULL,
  EmployeeID INT NOT NULL,
  PayrollID INT NOT NULL,
  PRIMARY KEY (BatchID, EmployeeID),
  UNIQUE KEY uq_payroll_processing_posting_payroll (PayrollID),
  CONSTRAINT fk_payroll_processing_posting_batch FOREIGN KEY (BatchID) REFERENCES attendance_dtr (BatchID) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_processing_posting_employee FOREIGN KEY (EmployeeID) REFERENCES employee (EmployeeID) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_processing_posting_payroll FOREIGN KEY (PayrollID) REFERENCES payroll (PayrollID) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
