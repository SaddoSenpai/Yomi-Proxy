// config/db.js
// Sets up and exports the connection pool for the Supabase (PostgreSQL) database.

const { Pool } = require('pg');

// Check if the DATABASE_URL is provided in the environment variables
if (!process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL is not defined in the .env file.');
}

// Create a new connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Use SSL for production connections to Supabase
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = pool;