-- Allows an employee transfer to be recorded before the receiving site has a shift setup.
-- Attendance under a deployment without a shift must be entered/reviewed manually until a
-- site shift is assigned.
ALTER TABLE employee_deployment
  MODIFY COLUMN SiteShiftID INT(11) NULL;
