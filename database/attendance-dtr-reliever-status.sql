-- Store a daily Reliever status separately from payable attendance.
-- Reliever means the employee is rostered in this DTR but worked at another site
-- that day, so the current DTR keeps no shift, time, or payable hours.
ALTER TABLE `attendance`
  MODIFY COLUMN `AttendanceStatus`
    ENUM(
      'Present',
      'Absent',
      'Late',
      'Half-Day',
      'On-Leave',
      'Holiday',
      'Rest Day',
      'Reliever'
    )
    NULL DEFAULT 'Present';

-- Repair rows saved before AttendanceStatus accepted 'Reliever'. MySQL stored
-- the unsupported enum value as an empty string while AttendanceType retained it.
UPDATE `attendance`
SET `AttendanceStatus` = 'Reliever'
WHERE (`AttendanceStatus` = '' OR `AttendanceStatus` IS NULL)
  AND `AttendanceType` = 'Reliever'
  AND `ShiftCodeID` IS NULL
  AND COALESCE(`RegularHours`, 0) = 0
  AND COALESCE(`OTHours`, 0) = 0
  AND COALESCE(`OTExtHours`, 0) = 0
  AND `TimeIn` IS NULL
  AND `TimeOut` IS NULL;
