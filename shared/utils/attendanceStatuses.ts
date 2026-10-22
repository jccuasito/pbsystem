export const attendanceStatuses = ['Present', 'Absent', 'Late', 'Half-Day', 'On-Leave', 'Vacation Leave', 'Holiday', 'Rest Day', 'Reliever', 'Sick Leave', 'Suspended'] as const

export const reasonRequiredAttendanceStatuses = new Set<string>(['Absent', 'Half-Day', 'On-Leave', 'Vacation Leave', 'Sick Leave', 'Suspended'])
