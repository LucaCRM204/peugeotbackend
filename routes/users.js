const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const router = express.Router();

// Función para obtener IDs accesibles
async function getAccessibleUserIds(userId) {
  try {
    const pool = getDB();
    const [usersResult] = await pool.query('SELECT id, role, reportsTo FROM users');
    const users = usersResult;
    
    const [currentUserResult] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
    if (currentUserResult.length === 0) return [userId];
    
    const userRole = currentUserResult[0].role;
    
    // Owner y Director ven todo
    if (['owner', 'director'].includes(userRole)) {
      return users.map(u => u.id);
    }
    
    // Construir árbol de jerarquía
    const childrenMap = new Map();
    users.forEach(u => childrenMap.set(u.id, []));
    users.forEach(u => {
      const reportsToId = u.reportsTo;
      if (reportsToId) {
        const children = childrenMap.get(reportsToId) || [];
        children.push(u.id);
        childrenMap.set(reportsToId, children);
      }
    });
    
    // Obtener todos los descendientes
    const getDescendants = (id) => {
      const result = [];
      const stack = [...(childrenMap.get(id) || [])];
      while (stack.length) {
        const currentId = stack.pop();
        result.push(currentId);
        const children = childrenMap.get(currentId) || [];
        stack.push(...children);
      }
      return result;
    };
    
    const descendants = getDescendants(userId);
    const accessibleIds = [userId, ...descendants];
    return accessibleIds;
  } catch (error) {
    console.error('Error getAccessibleUserIds:', error);
    return [userId];
  }
}

// Obtener todos los usuarios (con filtrado por jerarquía)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getDB();
    const userId = req.user.userId || req.user.id;
    
    // Obtener IDs accesibles
    const accessibleUserIds = await getAccessibleUserIds(userId);
    
    const [result] = await pool.query(`
      SELECT id, name, email, role, reportsTo, active, createdAt 
      FROM users 
      ORDER BY role, name
    `);
    
    // Filtrar usuarios por acceso
    const filteredUsers = result.filter(user => 
      accessibleUserIds.includes(user.id)
    );
    
    console.log(`👥 Usuarios filtrados para usuario ${userId}: ${filteredUsers.length} de ${result.length}`);
    
    res.json(filteredUsers);
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
    let query;
    let params;
    
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query = `
        UPDATE users 
        SET name = ?, email = ?, password = ?, role = ?, reportsTo = ?, active = ?
        WHERE id = ?
      `;
      params = [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0, id];
    } else {
      query = `
        UPDATE users 
        SET name = ?, email = ?, role = ?, reportsTo = ?, active = ?
        WHERE id = ?
      `;
      params = [name, email, role, reportsTo || null, active ? 1 : 0, id];
    }
    
    await pool.query(query, params);
    
    const [result] = await pool.query(
      'SELECT id, name, email, role, reportsTo, active FROM users WHERE id = ?',
      [id]
    );
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json(result[0]);
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
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true, message: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
});

module.exports = router;