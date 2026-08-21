ALTER TABLE attendance
  ADD COLUMN AttendanceType ENUM('Regular', 'Reliever') NOT NULL DEFAULT 'Regular' AFTER AttendanceStatus;
