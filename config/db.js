// config/db.js
// Sets up and exports the database connection using Knex.
// Supports both Supabase (PostgreSQL) and a local SQLite database.

const knex = require('knex');
const path = require('path');

let db;

if (process.env.DATABASE_URL) {
    // Use PostgreSQL if DATABASE_URL is provided
    console.log('DATABASE_URL provided, connecting to PostgreSQL...');
    db = knex({
        client: 'pg',
        connection: {
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        },
        pool: {
            min: 2,
            max: 10
        }
    });
} else {
    // Use SQLite for local development if no DATABASE_URL is set
    console.log('DATABASE_URL not found, falling back to local SQLite database...');
    const dbPath = path.join(__dirname, '..', 'yomi-proxy.db');
    db = knex({
        client: 'sqlite3',
        connection: {
            filename: dbPath
        },
        useNullAsDefault: true
    });
}

module.exports = db;
