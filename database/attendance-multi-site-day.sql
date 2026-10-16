-- Run scripts/apply-attendance-multi-site-day.mjs for idempotent application.
-- A pending HR status (BatchID NULL) retains a single unique scope (0).
ALTER TABLE attendance
  ADD COLUMN AttendanceScopeBatchID INT GENERATED ALWAYS AS (COALESCE(BatchID, 0)) PERSISTENT,
  ADD UNIQUE KEY uq_attendance_emp_date_scope (EmployeeID, AttendanceDate, AttendanceScopeBatchID),
  DROP INDEX uq_attendance_emp_date;
