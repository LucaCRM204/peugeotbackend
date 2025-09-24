const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Obtener todos los usuarios (solo para roles autorizados)
router.get('/', authenticateToken, authorizeRoles('owner', 'director', 'gerente'), (req, res) => {
  const db = getDB();
  db.all('SELECT id, name, email, role, reportsTo, active, createdAt FROM users ORDER BY role, name', (err, users) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error al obtener usuarios' });
    }
    res.json(users);
  });
});

// Crear usuario
router.post('/', authenticateToken, authorizeRoles('owner', 'director', 'gerente'), async (req, res) => {
  try {
    const { name, email, password, role, reportsTo, active = 1 } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Todos los campos obligatorios deben completarse' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const db = getDB();

    db.run(
      'INSERT INTO users (name, email, password, role, reportsTo, active) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'El email ya está registrado' });
          }
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Error al crear usuario' });
        }

        db.get('SELECT id, name, email, role, reportsTo, active FROM users WHERE id = ?', 
          [this.lastID], (err, user) => {
            if (err) {
              console.error('Database error:', err);
              return res.status(500).json({ error: 'Error al obtener usuario creado' });
            }
            res.status(201).json(user);
          }
        );
      }
    );
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar usuario
router.put('/:id', authenticateToken, authorizeRoles('owner', 'director', 'gerente'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, reportsTo, active } = req.body;

    let updateQuery = 'UPDATE users SET name = ?, email = ?, role = ?, reportsTo = ?, active = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?';
    let params = [name, email, role, reportsTo || null, active ? 1 : 0, id];

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery = 'UPDATE users SET name = ?, email = ?, password = ?, role = ?, reportsTo = ?, active = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?';
      params = [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0, id];
    }

    const db = getDB();
    db.run(updateQuery, params, function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error al actualizar usuario' });
      }

      db.get('SELECT id, name, email, role, reportsTo, active FROM users WHERE id = ?', 
        [id], (err, user) => {
          if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Error al obtener usuario actualizado' });
          }
          res.json(user);
        }
      );
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar usuario
router.delete('/:id', authenticateToken, authorizeRoles('owner'), (req, res) => {
  const { id } = req.params;
  const db = getDB();

  db.run('DELETE FROM users WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error al eliminar usuario' });
    }
    res.json({ ok: true, message: 'Usuario eliminado correctamente' });
  });
});

module.exports = router;