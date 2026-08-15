-- Phase 4: EmployeeID is the system identifier. EmployeeNumber is an optional badge/reference.
ALTER TABLE employee
  MODIFY COLUMN EmployeeNumber VARCHAR(30) NULL;
