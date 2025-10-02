const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Función para obtener IDs accesibles basado en jerarquía
async function getAccessibleUserIds(userId) {
  try {
    const pool = getDB();
    const usersResult = await pool.query('SELECT id, role, reportsto FROM users');
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
      if (u.reportsto) {
        const children = childrenMap.get(u.reportsto) || [];
        children.push(u.id);
        childrenMap.set(u.reportsto, children);
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
    
    const accessibleIds = [userId, ...getDescendants(userId)];
    return accessibleIds;
  } catch (error) {
    console.error('Error getAccessibleUserIds:', error);
    return [userId];
  }
}

// Obtener todos los leads (filtrados por jerarquía)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getDB();
    const accessibleUserIds = await getAccessibleUserIds(req.user.userId || req.user.id);
    
    const result = await pool.query(`
      SELECT l.*, u.name as "vendedorNombre" 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      ORDER BY l."createdAt" DESC
    `);
    
    // Filtrar leads por acceso
    const filteredLeads = result.rows.filter(lead => 
      !lead.vendedor || accessibleUserIds.includes(lead.vendedor)
    );
    
    res.json(filteredLeads);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al obtener leads' });
  }
});

// Crear lead
router.post('/', authenticateToken, async (req, res) => {
  const {
    nombre, telefono, email, modelo, formaPago, presupuesto,
    infoUsado, entrega, fecha, fuente, assigned_to, vendedor, notas
  } = req.body;

  // Soportar tanto 'assigned_to' como 'vendedor'
  const finalVendedor = assigned_to || vendedor;

  console.log('📥 Lead recibido:');
  console.log('   - Nombre:', nombre);
  console.log('   - Vendedor ID:', finalVendedor);
  console.log('   - Fuente:', fuente);

  if (!nombre || !telefono || !modelo) {
    return res.status(400).json({ error: 'Nombre, teléfono y modelo son obligatorios' });
  }

  // Verificar que el vendedor esté en el scope del usuario
  if (finalVendedor) {
    const accessibleUserIds = await getAccessibleUserIds(req.user.userId || req.user.id);
    if (!accessibleUserIds.includes(finalVendedor)) {
      return res.status(403).json({ error: 'No puedes asignar leads a ese vendedor' });
    }
  }

  const pool = getDB();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const leadResult = await client.query(`
      INSERT INTO leads (
        nombre, telefono, email, modelo, "formaPago", presupuesto,
        "infoUsado", entrega, fecha, fuente, vendedor, notas, estado, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
    `, [
      nombre, telefono, email, modelo, formaPago, presupuesto,
      infoUsado, entrega ? 1 : 0, fecha, fuente || 'creado_por', finalVendedor, notas || '', 'nuevo', req.user.userId || req.user.id
    ]);

    const leadId = leadResult.rows[0].id;
    console.log('✅ Lead guardado con ID:', leadId);

    // Agregar al historial
    await client.query(
      'INSERT INTO lead_history ("leadId", estado, usuario) VALUES ($1, $2, $3)',
      [leadId, 'nuevo', req.user.name]
    );

    // Obtener el lead creado
    const createdLead = await client.query(`
      SELECT l.*, u.name as "vendedorNombre" 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      WHERE l.id = $1
    `, [leadId]);

    await client.query('COMMIT');

    console.log('📤 Lead retornado - Vendedor:', createdLead.rows[0].vendedor, '-', createdLead.rows[0].vendedorNombre);
    
    res.status(201).json(createdLead.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al crear lead' });
  } finally {
    client.release();
  }
});

// Actualizar lead
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const {
    nombre, telefono, email, modelo, formaPago, presupuesto,
    infoUsado, entrega, fecha, fuente, assigned_to, vendedor, notas, estado
  } = req.body;

  // Soportar tanto 'assigned_to' como 'vendedor'
  const finalVendedor = assigned_to !== undefined ? assigned_to : vendedor;

  const pool = getDB();
  
  // Verificar acceso al lead
  const existingLeadResult = await pool.query('SELECT vendedor FROM leads WHERE id = $1', [id]);
  if (existingLeadResult.rows.length === 0) {
    return res.status(404).json({ error: 'Lead no encontrado' });
  }
  
  const accessibleUserIds = await getAccessibleUserIds(req.user.userId || req.user.id);
  const lead = existingLeadResult.rows[0];
  
  if (lead.vendedor && !accessibleUserIds.includes(lead.vendedor)) {
    return res.status(403).json({ error: 'No tienes acceso a este lead' });
  }

  // Si se está actualizando el vendedor, verificar que esté en scope
  if (finalVendedor !== undefined && finalVendedor !== null) {
    if (!accessibleUserIds.includes(finalVendedor)) {
      return res.status(403).json({ error: 'No puedes asignar leads a ese vendedor' });
    }
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Si hay cambio de estado, agregar al historial
    if (estado) {
      const currentLead = await client.query('SELECT estado FROM leads WHERE id = $1', [id]);
      if (currentLead.rows.length > 0 && currentLead.rows[0].estado !== estado) {
        await client.query(
          'INSERT INTO lead_history ("leadId", estado, usuario) VALUES ($1, $2, $3)',
          [id, estado, req.user.name]
        );
      }
    }

    await client.query(`
      UPDATE leads SET 
        nombre = $1, telefono = $2, email = $3, modelo = $4, "formaPago" = $5, 
        presupuesto = $6, "infoUsado" = $7, entrega = $8, fecha = $9, 
        fuente = $10, vendedor = $11, notas = $12, estado = $13, 
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $14
    `, [
      nombre, telefono, email, modelo, formaPago, presupuesto,
      infoUsado, entrega ? 1 : 0, fecha, fuente, finalVendedor, notas, estado, id
    ]);

    const updatedLead = await client.query(`
      SELECT l.*, u.name as "vendedorNombre" 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      WHERE l.id = $1
    `, [id]);

    await client.query('COMMIT');
    res.json(updatedLead.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al actualizar lead' });
  } finally {
    client.release();
  }
});

// Eliminar lead (solo owner)
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  // Verificar que sea owner
  const pool = getDB();
  const userResult = await pool.query('SELECT role FROM users WHERE id = $1', [req.user.userId || req.user.id]);
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'owner') {
    return res.status(403).json({ error: 'Solo el Dueño puede eliminar leads' });
  }
  
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM lead_history WHERE "leadId" = $1', [id]);
    await client.query('DELETE FROM leads WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ ok: true, message: 'Lead eliminado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar lead' });
  } finally {
    client.release();
  }
});

// Obtener historial de un lead
router.get('/:id/history', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getDB();
    const result = await pool.query(
      'SELECT * FROM lead_history WHERE "leadId" = $1 ORDER BY timestamp DESC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

module.exports = router;