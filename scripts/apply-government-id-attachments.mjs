import mysql from 'mysql2/promise'
const db = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'pbsystem' })
try {
  const [columns] = await db.execute("SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='government'")
  const byName = new Map(columns.map(row => [row.COLUMN_NAME, row.COLUMN_TYPE]))
  if (!byName.has('GovernmentID')) throw Error('The government table is not installed.')
  const changes = []
  if (byName.get('GovernmentType') !== 'varchar(80)') changes.push('MODIFY COLUMN GovernmentType VARCHAR(80) NOT NULL')
  for (const [name, definition] of Object.entries({ AttachmentPath: 'VARCHAR(80) NULL', AttachmentName: 'VARCHAR(255) NULL', AttachmentMimeType: 'VARCHAR(60) NULL', AttachmentSize: 'INT UNSIGNED NULL' })) {
    if (!byName.has(name)) changes.push('ADD COLUMN ' + name + ' ' + definition)
  }
  if (changes.length) await db.query('ALTER TABLE government ' + changes.join(', '))
  console.log('Government ID types and private scan attachments are ready. Existing records retained.')
} finally { await db.end() }
