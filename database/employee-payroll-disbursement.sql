-- Stores the effective salary payment method and the registered bank account holder.
-- Run once before using Payroll Disbursement in Add/Edit Employee.

ALTER TABLE employee_profile
  ADD COLUMN PaymentMethodEffectiveDate DATE NULL AFTER PaymentMethod;

ALTER TABLE bank
  ADD COLUMN AccountName VARCHAR(200) NULL AFTER EmployeeID;

UPDATE bank b
INNER JOIN employee e ON e.EmployeeID = b.EmployeeID
SET b.AccountName = UPPER(TRIM(CONCAT_WS(' ', e.FirstName, e.MiddleName, e.LastName)))
WHERE b.AccountName IS NULL OR TRIM(b.AccountName) = '';

ALTER TABLE bank
  MODIFY COLUMN AccountName VARCHAR(200) NOT NULL;
