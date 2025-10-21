const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Obtener todas las metas (filtradas por acceso)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getDB();
    const userId = req.user.userId || req.user.id;
    
    // Si es owner/director, ve todas las metas
    const [userResult] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
    const userRole = userResult[0]?.role;
    
    let query = `
      SELECT m.*, u.name as vendedor_name, u.email as vendedor_email
      FROM metas m
      INNER JOIN users u ON m.vendedor_id = u.id
      ORDER BY m.mes DESC, u.name ASC
    `;
    
    // Si no es owner/director, filtrar por jerarquía
    if (!['owner', 'director'].includes(userRole)) {
      // Obtener IDs accesibles (similar a users.js)
      const accessibleIds = await getAccessibleUserIds(userId);
      query = `
        SELECT m.*, u.name as vendedor_name, u.email as vendedor_email
        FROM metas m
        INNER JOIN users u ON m.vendedor_id = u.id
        WHERE m.vendedor_id IN (${accessibleIds.join(',')})
        ORDER BY m.mes DESC, u.name ASC
      `;
    }
    
    const [metas] = await pool.query(query);
    res.json(metas);
  } catch (err) {
    console.error('Error al obtener metas:', err);
    res.status(500).json({ error: 'Error al obtener metas' });
  }
});

// Crear meta
router.post('/', authenticateToken, authorizeRoles('owner', 'director', 'gerente', 'supervisor'), async (req, res) => {
  try {
    const { vendedor_id, mes, meta_ventas, meta_leads } = req.body;
    
    if (!vendedor_id || !mes || meta_ventas === undefined || meta_leads === undefined) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
    
    const pool = getDB();
    const userId = req.user.userId || req.user.id;
    
    const [result] = await pool.query(`
      INSERT INTO metas (vendedor_id, mes, meta_ventas, meta_leads, created_by)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        meta_ventas = VALUES(meta_ventas),
        meta_leads = VALUES(meta_leads),
        updated_at = CURRENT_TIMESTAMP
    `, [vendedor_id, mes, meta_ventas, meta_leads, userId]);
    
    const [newMeta] = await pool.query(`
      SELECT m.*, u.name as vendedor_name
      FROM metas m
      INNER JOIN users u ON m.vendedor_id = u.id
      WHERE m.vendedor_id = ? AND m.mes = ?
    `, [vendedor_id, mes]);
    
    res.status(201).json(newMeta[0]);
  } catch (err) {
    console.error('Error al crear meta:', err);
    res.status(500).json({ error: err.message || 'Error al crear meta' });
  }
});

// Actualizar meta
router.put('/:id', authenticateToken, authorizeRoles('owner', 'director', 'gerente', 'supervisor'), async (req, res) => {
  try {
    const { id } = req.params;
    const { meta_ventas, meta_leads } = req.body;
    
    const pool = getDB();
    
    await pool.query(`
      UPDATE metas
      SET meta_ventas = ?, meta_leads = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [meta_ventas, meta_leads, id]);
    
    const [updated] = await pool.query(`
      SELECT m.*, u.name as vendedor_name
      FROM metas m
      INNER JOIN users u ON m.vendedor_id = u.id
      WHERE m.id = ?
    `, [id]);
    
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Meta no encontrada' });
    }
    
    res.json(updated[0]);
  } catch (err) {
    console.error('Error al actualizar meta:', err);
    res.status(500).json({ error: 'Error al actualizar meta' });
  }
});

// Eliminar meta
router.delete('/:id', authenticateToken, authorizeRoles('owner', 'director', 'gerente', 'supervisor'), async (req, res) => {
  try {
    const { id } = req.params;
    const pool = getDB();
    
    await pool.query('DELETE FROM metas WHERE id = ?', [id]);
    res.json({ ok: true, message: 'Meta eliminada correctamente' });
  } catch (err) {
    console.error('Error al eliminar meta:', err);
    res.status(500).json({ error: 'Error al eliminar meta' });
  }
});

// Función helper (copiar de users.js)
async function getAccessibleUserIds(userId) {
  try {
    const pool = getDB();
    const [usersResult] = await pool.query('SELECT id, role, reportsTo FROM users');
    const users = usersResult;
    
    const [currentUserResult] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
    if (currentUserResult.length === 0) return [userId];
    
    const userRole = currentUserResult[0].role;
    
    if (['owner', 'director'].includes(userRole)) {
      return users.map(u => u.id);
    }
    
    const childrenMap = new Map();
    users.forEach(u => childrenMap.set(u.id, []));
    users.forEach(u => {
      if (u.reportsTo) {
        const children = childrenMap.get(u.reportsTo) || [];
        children.push(u.id);
        childrenMap.set(u.reportsTo, children);
      }
    });
    
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
    return [userId, ...descendants];
  } catch (error) {
    console.error('Error getAccessibleUserIds:', error);
    return [userId];
  }
}

module.exports = router;