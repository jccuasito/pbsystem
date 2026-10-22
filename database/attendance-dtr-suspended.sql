-- Append the HR suspension marker without changing existing enum ordinals.
ALTER TABLE `attendance`
  MODIFY COLUMN `AttendanceStatus`
    ENUM(
      'Present', 'Absent', 'Late', 'Half-Day', 'On-Leave', 'Vacation Leave',
      'Holiday', 'Rest Day', 'Reliever', 'Sick Leave', 'Suspended'
    ) NULL DEFAULT 'Present';
