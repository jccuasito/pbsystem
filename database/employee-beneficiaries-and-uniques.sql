-- Dynamic employee beneficiaries and database-level duplicate protection.
-- Apply with: node --env-file=.env scripts/apply-employee-beneficiaries-and-uniques.mjs

ALTER TABLE employee
  ADD COLUMN Beneficiaries JSON NULL AFTER Beneficiary2Relationship;

UPDATE employee
SET Beneficiaries = CASE
  WHEN BeneficiaryNotApplicable = 1 THEN JSON_ARRAY()
  ELSE JSON_MERGE_PRESERVE(
    IF(Beneficiary1 IS NULL OR TRIM(Beneficiary1) = '', JSON_ARRAY(), JSON_ARRAY(JSON_OBJECT('Name', Beneficiary1, 'Relationship', Beneficiary1Relationship))),
    IF(Beneficiary2 IS NULL OR TRIM(Beneficiary2) = '', JSON_ARRAY(), JSON_ARRAY(JSON_OBJECT('Name', Beneficiary2, 'Relationship', Beneficiary2Relationship)))
  )
END;

-- Empty optional identifiers must be NULL so unique indexes can accept many employees
-- without an email/contact number during migration of older data.
UPDATE employee SET Email = NULL WHERE TRIM(COALESCE(Email, '')) = '';
UPDATE employee SET ContactNumber = NULL WHERE TRIM(COALESCE(ContactNumber, '')) = '';

ALTER TABLE employee
  ADD UNIQUE KEY uq_employee_email (Email),
  ADD UNIQUE KEY uq_employee_contact_number (ContactNumber);
