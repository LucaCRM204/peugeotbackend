const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Configuración de PostgreSQL desde las variables de entorno de Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initDatabase = async () => {
  try {
    console.log('Conectando a PostgreSQL...');
    
    // Verificar conexión
    await pool.query('SELECT NOW()');
    console.log('✅ Conectado a PostgreSQL');
    
    await createTables();
    console.log('✅ Tablas creadas correctamente');
  } catch (err) {
    console.error('❌ Error inicializando base de datos:', err);
    throw err;
  }
};

const createTables = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Tabla de usuarios
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'vendedor',
        "reportsTo" INTEGER REFERENCES users(id),
        active INTEGER DEFAULT 1,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de leads
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        telefono VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        modelo VARCHAR(255) NOT NULL,
        "formaPago" VARCHAR(100),
        presupuesto VARCHAR(100),
        "infoUsado" TEXT,
        entrega INTEGER DEFAULT 0,
        fecha DATE,
        estado VARCHAR(50) DEFAULT 'nuevo',
        vendedor INTEGER REFERENCES users(id),
        fuente VARCHAR(50) DEFAULT 'otro',
        notas TEXT,
        "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tabla de historial de leads
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_history (
        id SERIAL PRIMARY KEY,
        "leadId" INTEGER NOT NULL REFERENCES leads(id),
        estado VARCHAR(50) NOT NULL,
        usuario VARCHAR(255) NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Crear usuario inicial si no existe
    const userCheck = await client.query('SELECT id FROM users WHERE id = 1');
    
    if (userCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('Luca2702', 10);
      await client.query(`
        INSERT INTO users (id, name, email, password, role, active)
        VALUES (1, 'Luca', 'Luca@alluma.com', $1, 'owner', 1)
      `, [hashedPassword]);
      console.log('✅ Usuario inicial creado: Luca');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getDB = () => pool;

module.exports = { initDatabase, getDB };