-- Persist the Work Day Off marker used by DTR, payroll, and billing.
-- Run once against the pbsystem database before deploying this feature.
ALTER TABLE attendance
  ADD COLUMN IsWDO TINYINT(1) NOT NULL DEFAULT 0 AFTER AttendanceType,
  ADD KEY idx_attendance_dtr_employee_wdo (BatchID, EmployeeID, IsWDO);
