const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Obtener todos los usuarios (solo para roles autorizados)
router.get('/', authenticateToken, authorizeRoles('owner', 'director', 'gerente'), async (req, res) => {
  try {
    const pool = getDB();
    const result = await pool.query(`
      SELECT id, name, email, role, "reportsTo", active, "createdAt" 
      FROM users 
      ORDER BY role, name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Crear usuario
router.post('/', authenticateToken, authorizeRoles('owner', 'director', 'gerente'), async (req, res) => {
  try {
    const { name, email, password, role, reportsTo, active = 1 } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Todos los campos obligatorios deben completarse' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const pool = getDB();

    const result = await pool.query(`
      INSERT INTO users (name, email, password, role, "reportsTo", active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, role, "reportsTo", active
    `, [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar usuario
router.put('/:id', authenticateToken, authorizeRoles('owner', 'director', 'gerente'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, reportsTo, active } = req.body;

    const pool = getDB();

    let query;
    let params;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = `
        UPDATE users 
        SET name = $1, email = $2, password = $3, role = $4, "reportsTo" = $5, 
            active = $6, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING id, name, email, role, "reportsTo", active
      `;
      params = [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0, id];
    } else {
      query = `
        UPDATE users 
        SET name = $1, email = $2, role = $3, "reportsTo" = $4, active = $5, 
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING id, name, email, role, "reportsTo", active
      `;
      params = [name, email, role, reportsTo || null, active ? 1 : 0, id];
    }

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar usuario
router.delete('/:id', authenticateToken, authorizeRoles('owner'), async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = getDB();
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ ok: true, message: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;