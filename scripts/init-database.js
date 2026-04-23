import mysql from 'mysql2/promise'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse DATABASE_URL for MySQL connection
function parseDatabaseUrl() {
  const url = process.env.DATABASE_URL || 'mysql://root@localhost:3306/casino'

  const match = url.match(/^mysql:\/\/([^:]+):?([^@]*)@([^:]+):?(\d+)?\/?(.+)?$/)

  if (match) {
    return {
      host: match[3] || 'localhost',
      port: parseInt(match[4] || '3306'),
      user: match[1] || 'root',
      password: match[2] || '',
      database: match[5] || 'casino',
    }
  }

  return {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'casino',
  }
}

async function initDatabase() {
  const config = parseDatabaseUrl()
  const dbName = config.database

  console.log(`Initializing database: ${dbName}`)

  // Create connection without database (to create database)
  const { database, ...configWithoutDb } = config
  const tempConnection = await mysql.createConnection(configWithoutDb)

  try {
    // Create database if it doesn't exist
    await tempConnection.execute(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
    console.log(`✓ Database '${dbName}' created or already exists`)
  } finally {
    await tempConnection.end()
  }

  // Now connect to the specific database to run migrations
  const connection = await mysql.createConnection({
    ...config,
    multipleStatements: true,
  })

  try {
    // Run initialization scripts
    const sqlFiles = [
      '001_init_database.sql',
      '002_payment_tables.sql',
      'add_is_partner.sql',
      'add-partner-tables.sql',
    ]

    for (const file of sqlFiles) {
      const filePath = path.join(process.cwd(), 'scripts', file)
      if (fs.existsSync(filePath)) {
        console.log(`Running ${file}...`)
        const sql = fs.readFileSync(filePath, 'utf-8')
        await connection.query(sql)
        console.log(`✓ ${file} completed`)
      } else {
        console.log(`⚠ ${file} not found, skipping`)
      }
    }

    console.log('\n✓ Database initialization completed successfully')
  } catch (error) {
    console.error('\n✗ Database initialization failed:', error)
    process.exit(1)
  } finally {
    await connection.end()
  }
}

initDatabase()
