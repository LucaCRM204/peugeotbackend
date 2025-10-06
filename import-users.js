const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const users = [
  // Director
  { name: 'Director Nombre', email: 'director@peugeot.com', password: 'Director123', role: 'director', reportsTo: 'Luca@alluma.com' },
  
  // Gerente
  { name: 'Dario Pelegrin', email: 'dario pelegrin', password: 'darioP123', role: 'gerente', reportsTo: 'director@peugeot.com' },
  
  // Supervisores y vendedores - Equipo 1
  { name: 'Matias Ledesma', email: 'matias ledesma', password: 'Matias123', role: 'supervisor', reportsTo: 'dario pelegrin' },
  { name: 'Jesica Almiron', email: 'jesica almiron', password: 'Jeal123', role: 'vendedor', reportsTo: 'matias ledesma' },
  { name: 'Lautaro Robledo', email: 'lautaro robledo', password: 'LautaRo123', role: 'vendedor', reportsTo: 'matias ledesma' },
  { name: 'Carlos Meza', email: 'carlos meza', password: 'Cmeza123', role: 'vendedor', reportsTo: 'matias ledesma' },
  
  // Supervisores y vendedores - Equipo 2
  { name: 'Esteche Cecilia', email: 'esteche cecilia', password: 'Esteche123', role: 'supervisor', reportsTo: 'dario pelegrin' },
  { name: 'Mansilla Martina', email: 'mansilla martina', password: 'MarMan123', role: 'vendedor', reportsTo: 'esteche cecilia' },
  { name: 'Petrillo Camila', email: 'petrillo camila', password: 'CamiPe123', role: 'vendedor', reportsTo: 'esteche cecilia' },
  { name: 'Gutierrez Alejandro', email: 'gutierrez alejandro', password: 'Gutie123', role: 'vendedor', reportsTo: 'esteche cecilia' },
  { name: 'Laino Santiago', email: 'laino santiago', password: 'Laino987', role: 'vendedor', reportsTo: 'esteche cecilia' },
  { name: 'Escudero Matias', email: 'escudero matias', password: 'Escu987', role: 'vendedor', reportsTo: 'esteche cecilia' },
  { name: 'Moreno Leonel', email: 'moreno leonel', password: 'Moreno245', role: 'vendedor', reportsTo: 'esteche cecilia' },
  { name: 'Melgarejo Mia', email: 'melgarejo mia', password: 'Melga951', role: 'vendedor', reportsTo: 'esteche cecilia' }
];

async function importUsers() {
  const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306
  });

  try {
    console.log('Conectando a MySQL...');
    
    // Mapa de emails a IDs
    const emailToId = {};
    
    // Primero obtener el ID del owner (Luca)
    const [ownerResult] = await pool.query('SELECT id FROM users WHERE email = ?', ['Luca@alluma.com']);
    const ownerId = ownerResult[0]?.id;
    
    if (!ownerId) {
      console.error('No se encontró el usuario owner (Luca@alluma.com)');
      return;
    }

    console.log(`Owner ID encontrado: ${ownerId}\n`);

    // Crear usuarios en orden jerárquico
    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      
      let reportsToId = null;
      if (user.reportsTo) {
        reportsToId = emailToId[user.reportsTo];
      } else if (user.role === 'director') {
        reportsToId = ownerId; // El director reporta al owner
      }

      const [result] = await pool.query(
        'INSERT INTO users (name, email, password, role, reportsTo, active) VALUES (?, ?, ?, ?, ?, 1)',
        [user.name, user.email, hashedPassword, user.role, reportsToId]
      );

      emailToId[user.email] = result.insertId;
      console.log(`✓ Creado: ${user.name} (${user.role}) - reporta a ID: ${reportsToId || 'ninguno'}`);
    }

    console.log('\n✅ Todos los usuarios fueron creados exitosamente');
    console.log('\nJerarquía creada:');
    console.log('Luca (owner)');
    console.log('  └─ Director');
    console.log('      └─ Dario Pelegrin (gerente)');
    console.log('          ├─ Matias Ledesma (supervisor)');
    console.log('          │   ├─ Jesica Almiron (vendedor)');
    console.log('          │   ├─ Lautaro Robledo (vendedor)');
    console.log('          │   └─ Carlos Meza (vendedor)');
    console.log('          └─ Esteche Cecilia (supervisor)');
    console.log('              ├─ Mansilla Martina (vendedor)');
    console.log('              ├─ Petrillo Camila (vendedor)');
    console.log('              ├─ Gutierrez Alejandro (vendedor)');
    console.log('              ├─ Laino Santiago (vendedor)');
    console.log('              ├─ Escudero Matias (vendedor)');
    console.log('              ├─ Moreno Leonel (vendedor)');
    console.log('              └─ Melgarejo Mia (vendedor)');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

importUsers();