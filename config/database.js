const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/peugeot_crm.db');

let db;

const initDatabase = () => {
  return new Promise((resolve, reject) => {
    // Crear directorio data si no existe
    const fs = require('fs');
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      console.log('Connected to SQLite database');
      createTables().then(resolve).catch(reject);
    });
  });
};

const createTables = () => {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      // Tabla de usuarios
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'vendedor',
          reportsTo INTEGER,
          active INTEGER DEFAULT 1,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (reportsTo) REFERENCES users (id)
        )
      `);

      // Tabla de leads
      db.run(`
        CREATE TABLE IF NOT EXISTS leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          telefono TEXT NOT NULL,
          email TEXT,
          modelo TEXT NOT NULL,
          formaPago TEXT,
          presupuesto TEXT,
          infoUsado TEXT,
          entrega INTEGER DEFAULT 0,
          fecha DATE,
          estado TEXT DEFAULT 'nuevo',
          vendedor INTEGER,
          fuente TEXT DEFAULT 'otro',
          notas TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (vendedor) REFERENCES users (id)
        )
      `);

      // Tabla de historial de leads
      db.run(`
        CREATE TABLE IF NOT EXISTS lead_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          leadId INTEGER NOT NULL,
          estado TEXT NOT NULL,
          usuario TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (leadId) REFERENCES leads (id)
        )
      `);

      // Crear usuario inicial
      const hashedPassword = await bcrypt.hash('Luca2702', 10);
      db.run(`
        INSERT OR IGNORE INTO users (id, name, email, password, role, active)
        VALUES (1, 'Luca', 'Luca@alluma.com', ?, 'owner', 1)
      `, [hashedPassword], (err) => {
        if (err) {
          console.error('Error creating initial user:', err);
          reject(err);
        } else {
          console.log('Database tables created and initial user added');
          resolve();
        }
      });
    });
  });
};

const getDB = () => db;

module.exports = { initDatabase, getDB };