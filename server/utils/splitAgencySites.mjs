// Installation utility, not an HTTP endpoint. The caller backs up the database first.
const siteColumns = ['ClientID','RegionID','SiteName','SiteAddress','LogoData','LogoMimeType','Status','SiteAccountID']
const policyColumns = ['NDEnabled','DayShiftNDEnabled','NDStartTime','NDEndTime','AutoBreakEnabled','DefaultBreakMinutes','RelieverPositionOverrideEnabled','AutoWDOEnabled','SundayWDOOTEnabled','GraceMinutes','LateAfterMinutes','ComputeLate','ComputeUndertime','ComputeOT','ComputeHoliday','ComputeRestDay','Status','CreatedAt']

export async function splitAgencySites(db, { siteIds = [], restoreSiteIds = [] } = {}) {
  const scope = [...new Set(siteIds.map(Number))]
  if (!scope.length || scope.some(id => !Number.isInteger(id) || id <= 0) || restoreSiteIds.some(id => !scope.includes(Number(id)))) throw new Error('Explicit site IDs are required; restoration must remain inside that scope.')
  const restored = new Set(restoreSiteIds.map(Number))
  await db.beginTransaction()
  try {
    const [sites] = await db.execute(`SELECT SiteID FROM site WHERE SiteID IN (${scope.map(() => '?').join(',')}) ORDER BY SiteID FOR UPDATE`, scope)
    const [links] = await db.execute(`SELECT SiteID,AgencyID,Status,SiteAccountID FROM site_agency WHERE SiteID IN (${scope.map(() => '?').join(',')}) ORDER BY SiteID,AgencyID FOR UPDATE`, scope)
    const changes = []
    for (const site of sites) {
      const coverage = links.filter(link => Number(link.SiteID) === Number(site.SiteID))
      if (coverage.length < 2) continue
      const id = Number(site.SiteID)
      // Billing headers have no agency identity. Never guess the owner of existing billing lines.
      const [[billing]] = await db.execute('SELECT COUNT(*) AS total FROM billing_detail WHERE SiteID=?', [id])
      if (Number(billing.total)) throw new Error('Shared site has billing lines without an agency reference; resolve ownership before splitting.')
      const [owners] = await db.execute(`SELECT AgencyID FROM attendance_dtr WHERE SiteID=?
        UNION SELECT ap.AgencyID FROM site_rate sr JOIN payroll_rate pr ON pr.PayrollRateID=sr.PayrollRateID JOIN agency_position ap ON ap.AgencyPositionID=pr.AgencyPositionID WHERE sr.SiteID=?
        UNION SELECT sc.AgencyID FROM site_shift ss JOIN shift_code sc ON sc.ShiftCodeID=ss.ShiftCodeID WHERE ss.SiteID=?`, [id,id,id])
      if (owners.some(owner => !coverage.some(link => Number(link.AgencyID) === Number(owner.AgencyID)))) throw new Error('Shared site has an unassigned agency reference; no data was changed.')
      const [[mismatch]] = await db.execute(`SELECT COUNT(*) AS total FROM employee_deployment ed
        LEFT JOIN site_rate sr ON sr.SiteRateID=ed.SiteRateID LEFT JOIN site_shift ss ON ss.SiteShiftID=ed.SiteShiftID
        LEFT JOIN payroll_rate pr ON pr.PayrollRateID=sr.PayrollRateID LEFT JOIN agency_position ap ON ap.AgencyPositionID=pr.AgencyPositionID LEFT JOIN shift_code sc ON sc.ShiftCodeID=ss.ShiftCodeID
        WHERE ed.SiteID=? AND (sr.SiteID IS NULL OR sr.SiteID<>ed.SiteID OR (ed.SiteShiftID IS NOT NULL AND (ss.SiteID IS NULL OR ss.SiteID<>ed.SiteID OR sc.AgencyID<>ap.AgencyID)))`, [id])
      if (Number(mismatch.total)) throw new Error('Shared site has inconsistent deployment references; no data was changed.')
      for (const link of coverage.slice(1)) {
        const agencyId = Number(link.AgencyID)
        const [created] = await db.execute(`INSERT INTO site (${siteColumns.join(',')}) SELECT ${siteColumns.join(',')} FROM site WHERE SiteID=?`, [id])
        const newId = Number(created.insertId)
        await db.execute(`INSERT INTO site_policy (SiteID,${policyColumns.join(',')}) SELECT ?,${policyColumns.join(',')} FROM site_policy WHERE SiteID=?`, [newId,id])
        await db.execute('INSERT INTO site_special_holiday (SiteID,HolidayID,CreatedAt,UpdatedAt) SELECT ?,HolidayID,CreatedAt,UpdatedAt FROM site_special_holiday WHERE SiteID=?', [newId,id])
        // Keep rate/shift/deployment/batch IDs and monetary amounts; only their site identity changes.
        await db.execute(`UPDATE employee_deployment ed JOIN site_rate sr ON sr.SiteRateID=ed.SiteRateID
          JOIN payroll_rate pr ON pr.PayrollRateID=sr.PayrollRateID JOIN agency_position ap ON ap.AgencyPositionID=pr.AgencyPositionID
          SET ed.SiteID=? WHERE ed.SiteID=? AND ap.AgencyID=?`, [newId,id,agencyId])
        await db.execute(`UPDATE site_rate sr JOIN payroll_rate pr ON pr.PayrollRateID=sr.PayrollRateID JOIN agency_position ap ON ap.AgencyPositionID=pr.AgencyPositionID
          SET sr.SiteID=? WHERE sr.SiteID=? AND ap.AgencyID=?`, [newId,id,agencyId])
        await db.execute('UPDATE site_shift ss JOIN shift_code sc ON sc.ShiftCodeID=ss.ShiftCodeID SET ss.SiteID=? WHERE ss.SiteID=? AND sc.AgencyID=?', [newId,id,agencyId])
        await db.execute('UPDATE attendance_dtr SET SiteID=? WHERE SiteID=? AND AgencyID=?', [newId,id,agencyId])
        await db.execute('UPDATE site_agency SET SiteID=? WHERE SiteID=? AND AgencyID=?', [newId,id,agencyId])
        await db.execute('UPDATE site SET SiteAccountID=? WHERE SiteID=?', [link.SiteAccountID,newId])
        if (restored.has(id)) await db.execute("UPDATE site SET Status='Active' WHERE SiteID=?", [newId])
        changes.push({ previousSiteId:id, siteId:newId, agencyId })
      }
      await db.execute('UPDATE site SET SiteAccountID=? WHERE SiteID=?', [coverage[0].SiteAccountID,id])
    }
    for (const id of restored) {
      if (!Number.isInteger(id) || id <= 0 || !sites.some(site => Number(site.SiteID) === id)) throw new Error('Restore site was not found.')
      await db.execute("UPDATE site SET Status='Active' WHERE SiteID=?", [id])
    }
    await db.commit()
    return changes
  } catch (error) { await db.rollback(); throw error }
}
