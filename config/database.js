const mysql = require('mysql2/promise');

let pool;

const initDatabase = async () => {
  try {
    console.log('Conectando a MySQL...');
    
    pool = mysql.createPool({
      host: process.env.MYSQLHOST,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE,
      port: process.env.MYSQLPORT || 3306,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    await pool.query('SELECT 1');
    console.log('✅ MySQL conectado correctamente');
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error);
    throw error;
  }
};

const getDB = () => {
  if (!pool) {
    throw new Error('Database no inicializada');
  }
  return pool;
};

module.exports = { initDatabase, getDB };