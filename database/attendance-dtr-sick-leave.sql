-- Add the HR leave markers used by Employee Status and DTR details.
ALTER TABLE `attendance`
  MODIFY COLUMN `AttendanceStatus`
    ENUM(
      'Present',
      'Absent',
      'Late',
      'Half-Day',
      'On-Leave',
      'Vacation Leave',
      'Holiday',
      'Rest Day',
      'Reliever',
      'Sick Leave'
    )
    NULL DEFAULT 'Present';
