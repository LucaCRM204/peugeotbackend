const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const router = express.Router();

// Función para obtener IDs accesibles (igual que en leads.js)
async function getAccessibleUserIds(userId) {
  try {
    const pool = getDB();
    const usersResult = await pool.query('SELECT id, role, "reportsTo" as "reportsTo" FROM users');
    const users = usersResult.rows;
    
    const currentUserResult = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (currentUserResult.rows.length === 0) return [userId];
    
    const userRole = currentUserResult.rows[0].role;
    
    // Owner y Director ven todo
    if (['owner', 'director'].includes(userRole)) {
      return users.map(u => u.id);
    }
    
    // Construir árbol de jerarquía
    const childrenMap = new Map();
    users.forEach(u => childrenMap.set(u.id, []));
    users.forEach(u => {
      const reportsToId = u.reportsTo || u.reportsto;
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
    
    const result = await pool.query(`
      SELECT id, name, email, role, "reportsTo", active, "createdAt" 
      FROM users 
      ORDER BY role, name
    `);
    
    // Filtrar usuarios por acceso
    const filteredUsers = result.rows.filter(user => 
      accessibleUserIds.includes(user.id)
    );
    
    console.log(`👥 Usuarios filtrados para usuario ${userId}: ${filteredUsers.length} de ${result.rows.length}`);
    
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
    
    const result = await pool.query(`
      INSERT INTO users (name, email, password, role, "reportsTo", active)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, role, "reportsTo", active
    `, [name, email, hashedPassword, role, reportsTo || null, active ? 1 : 0]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
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