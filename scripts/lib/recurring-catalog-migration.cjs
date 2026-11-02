// Move scheduled/refundable items without replacing catalog or financial IDs.
module.exports = async function migrateRecurringCatalog(db) {
  await db.beginTransaction()
  try {
    const [classes] = await db.execute("SELECT * FROM deduction_loan_classification WHERE AppliesTo='Deduction' ORDER BY ClassificationID FOR UPDATE")
    let moved = 0
    for (const group of classes) {
      const [items] = await db.execute(`SELECT d.DeductionTypeID,d.DeductionName,d.IsRefundable,
        EXISTS(SELECT 1 FROM agency_contribution_plan p WHERE p.DeductionTypeID=d.DeductionTypeID) HasPlan,
        EXISTS(SELECT 1 FROM employee_deduction e WHERE e.DeductionTypeID=d.DeductionTypeID) HasIssuance,
        EXISTS(SELECT 1 FROM employee_recurring_deduction r WHERE r.DeductionTypeID=d.DeductionTypeID) HasEmployeePlan
        FROM deduction_type d WHERE d.ClassificationID=? FOR UPDATE`, [group.ClassificationID])
      const eligible=items.filter(item=>Number(item.IsRefundable)||Number(item.HasPlan))
      if(!eligible.length)continue
      if(eligible.some(item=>Number(item.HasIssuance)||Number(item.HasEmployeePlan)))throw Error('An existing employee issuance/plan needs explicit mapping before its catalog type can change. No records were removed.')
      const [[target]]=await db.execute("SELECT ClassificationID FROM deduction_loan_classification WHERE AppliesTo='Recurring Deduction' AND ClassificationName=? FOR UPDATE",[group.ClassificationName])
      if(eligible.length===items.length&&!target){
        await db.execute("UPDATE deduction_loan_classification SET AppliesTo='Recurring Deduction' WHERE ClassificationID=?",[group.ClassificationID])
      }else{
        let targetId=target?.ClassificationID
        if(!targetId){const [insert]=await db.execute("INSERT INTO deduction_loan_classification(ClassificationName,AppliesTo,Description,Status) VALUES(?,'Recurring Deduction',?,?)",[group.ClassificationName,group.Description,group.Status]);targetId=insert.insertId}
        for(const item of eligible)await db.execute('UPDATE deduction_type SET ClassificationID=? WHERE DeductionTypeID=?',[targetId,item.DeductionTypeID])
      }
      moved+=eligible.length
    }
    await db.commit()
    return {moved}
  }catch(error){await db.rollback();throw error}
}
