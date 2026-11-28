// Fixed schema identifiers only. Reuse existing indexes rather than doubling
// the write/storage cost of the former ID-only indexes.
export async function ensureActivityHistoryIndexes(db) {
  const indexes = {
    ix_activity_time_cursor: ['CreatedAt', 'EventID'],
    ix_activity_scope_cursor: ['Scope', 'CreatedAt', 'EventID'],
    ix_activity_actor_cursor: ['ActorUserID', 'CreatedAt', 'EventID'],
    ix_activity_scope_actor_cursor: ['Scope', 'ActorUserID', 'CreatedAt', 'EventID'],
    ix_activity_scope_actor_action_cursor: ['Scope', 'ActorUserID', 'Action', 'CreatedAt', 'EventID'],
    ix_activity_scope_action_cursor: ['Scope', 'Action', 'CreatedAt', 'EventID'],
    ix_activity_actor_action_cursor: ['ActorUserID', 'Action', 'CreatedAt', 'EventID'],
    ix_activity_action_cursor: ['Action', 'CreatedAt', 'EventID'],
  }
  const [rows] = await db.execute("SELECT INDEX_NAME,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user_activity_event' ORDER BY INDEX_NAME,SEQ_IN_INDEX")
  const existing = new Map()
  for (const row of rows) existing.set(row.INDEX_NAME, [...(existing.get(row.INDEX_NAME) || []), row.COLUMN_NAME])
  const changes = []
  for (const [name, columns] of Object.entries(indexes)) {
    if (JSON.stringify(existing.get(name)) === JSON.stringify(columns)) continue
    if (existing.has(name)) changes.push(`DROP INDEX \`${name}\``)
    changes.push(`ADD INDEX \`${name}\` (${columns.map(column => `\`${column}\``).join(',')})`)
  }
  if (changes.length) await db.query(`ALTER TABLE user_activity_event ${changes.join(',')}`)
  return changes.length > 0
}
