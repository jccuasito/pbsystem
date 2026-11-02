import fs from 'node:fs/promises'
import mysql from 'mysql2/promise'
import migrateRecurring from './lib/recurring-catalog-migration.cjs'
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'pbsystem',multipleStatements:true})
try {
 const [[column]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='deduction_type' AND COLUMN_NAME='IsRefundable'")
 if(!Number(column.n))await db.query('ALTER TABLE deduction_type ADD COLUMN IsRefundable TINYINT(1) NOT NULL DEFAULT 0')
 // Upgrade the provisional, unused cash-bond tables without deleting any records.
 const [[old]]=await db.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cash_bond_account'")
 if(Number(old.n)){
  const [[typed]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cash_bond_account' AND COLUMN_NAME='DeductionTypeID'")
  if(!Number(typed.n)){
   for(const table of ['cash_bond_plan','cash_bond_account','cash_bond_cutoff_override','cash_bond_ledger']){
    const [[used]]=await db.query(`SELECT COUNT(*) n FROM ${table}`)
    if(Number(used.n))throw Error('Existing provisional cash-bond data needs an explicit catalog mapping before upgrade; no records were removed.')
   }
   await db.query('ALTER TABLE cash_bond_account DROP INDEX uq_cash_bond_employee_agency, ADD COLUMN DeductionTypeID INT NOT NULL, ADD UNIQUE KEY uq_cash_bond_employee_agency(EmployeeID,AgencyID,DeductionTypeID), ADD FOREIGN KEY(DeductionTypeID) REFERENCES deduction_type(DeductionTypeID)')
   await db.query("ALTER TABLE cash_bond_cutoff_override DROP INDEX uq_cash_bond_cutoff_override, DROP COLUMN ActiveKey, ADD COLUMN DeductionTypeID INT NOT NULL, ADD COLUMN ActiveKey VARCHAR(100) GENERATED ALWAYS AS (CASE WHEN RemovedAt IS NULL THEN CONCAT(EmployeeID,':',AgencyID,':',DeductionTypeID,':',PeriodStart,':',PeriodEnd) ELSE NULL END) STORED, ADD UNIQUE KEY uq_cash_bond_cutoff_override(ActiveKey), ADD FOREIGN KEY(DeductionTypeID) REFERENCES deduction_type(DeductionTypeID)")
   await db.query('ALTER TABLE cash_bond_ledger ADD INDEX ix_cash_bond_payroll(PayrollID), DROP INDEX uq_cash_bond_payroll, ADD UNIQUE KEY uq_cash_bond_payroll(PayrollID,AccountID)')
  }
 }
 await db.query((await fs.readFile(new URL('../database/cash-bonds.sql',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
 // The existing CashBond classification had no sub-classification. Make it selectable in the shared plans.
 await db.query(`INSERT INTO deduction_type(DeductionName,ClassificationID,DeductionCategory,DeductionPeriod,IsRefundable,Status)
 SELECT c.ClassificationName,c.ClassificationID,'Company','Semi-Monthly',1,'Active' FROM deduction_loan_classification c
 WHERE LOWER(REPLACE(c.ClassificationName,' ',''))='cashbond' AND c.AppliesTo='Deduction' AND c.Status='Active'
 AND NOT EXISTS(SELECT 1 FROM deduction_type d WHERE d.ClassificationID=c.ClassificationID)`)
 await db.query(await fs.readFile(new URL('../database/recurring-deductions.sql',import.meta.url),'utf8'))
 await migrateRecurring(db)
 console.log('Contributions and Others schema ready. No payroll plans, balances or financial transactions were seeded.')
} finally {await db.end()}
