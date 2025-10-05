const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Obtener todos los usuarios
router.get('/', authenticateToken, authorizeRoles('owner', 'director', 'gerente'), async (req, res) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(`
      SELECT id, name, email, role, reportsTo, active, createdAt 
      FROM users 
      ORDER BY role, name
    `);
    res.json(rows);
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

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const pool = getDB();

    const [result] = await pool.query(`
      INSERT INTO users (name, email, password, role, reportsTo, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0]);

    const [newUser] = await pool.query(
      'SELECT id, name, email, role, reportsTo, active FROM users WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newUser[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
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

    const [existingUser] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (existingUser.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (password && password.trim()) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(`
        UPDATE users 
        SET name = ?, email = ?, password = ?, role = ?, reportsTo = ?, active = ?
        WHERE id = ?
      `, [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0, id]);
    } else {
      await pool.query(`
        UPDATE users 
        SET name = ?, email = ?, role = ?, reportsTo = ?, active = ?
        WHERE id = ?
      `, [name, email, role, reportsTo || null, active ? 1 : 0, id]);
    }

    const [updatedUser] = await pool.query(
      'SELECT id, name, email, role, reportsTo, active FROM users WHERE id = ?',
      [id]
    );

    res.json(updatedUser[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar usuario
router.delete('/:id', authenticateToken, authorizeRoles('owner'), async (req, res) => {
  const { id } = req.params;
  
  try {
    const pool = getDB();
    
    const [existingUser] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (existingUser.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    if (existingUser[0].role === 'owner') {
      return res.status(403).json({ error: 'No se puede eliminar al dueño del sistema' });
    }

    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true, message: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;