import mysql from 'mysql2/promise'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse DATABASE_URL for MySQL connection
function parseDatabaseUrl() {
  const url = process.env.DATABASE_URL || 'mysql://root@localhost:3306/casino'

  // Simple URL parser for mysql://user:pass@host:port/dbname format
  const match = url.match(/^mysql:\/\/([^:]+):?([^@]*)@([^:]+):?(\d+)?\/?(.+)?$/)

  if (match) {
    return {
      host: match[3] || 'localhost',
      port: parseInt(match[4] || '3306'),
      user: match[1] || 'root',
      password: match[2] || '',
      database: match[5] || 'casino',
      multipleStatements: true,  // Important for running multi-statement SQL files
    }
  }

  // Fallback to default
  return {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'casino',
    multipleStatements: true,
  }
}

async function runMigration() {
  const config = parseDatabaseUrl()
  const connection = await mysql.createConnection(config)

  try {
    console.log('Starting migration...')

    // Read and execute the SQL migration
    const sqlPath = path.join(process.cwd(), 'scripts', 'add_is_partner.sql')
    const sql = fs.readFileSync(sqlPath, 'utf-8')

    await connection.query(sql)
    console.log('✓ Migration completed successfully')
  } catch (error) {
    console.error('✗ Migration failed:', error)
    process.exit(1)
  } finally {
    await connection.end()
  }
}

runMigration()
