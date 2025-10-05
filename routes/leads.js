const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Obtener todos los leads
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getDB();
    const result = await pool.query(`
      SELECT l.*, u.name as "vendedorNombre" 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      ORDER BY l."createdAt" DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al obtener leads' });
  }
});

// Crear lead
router.post('/', authenticateToken, async (req, res) => {
  const {
    nombre, telefono, email, modelo, formaPago, presupuesto,
    infoUsado, entrega, fecha, fuente, vendedor, notas
  } = req.body;

  if (!nombre || !telefono || !modelo) {
    return res.status(400).json({ error: 'Nombre, teléfono y modelo son obligatorios' });
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
      nombre, 
      telefono, 
      email || null, 
      modelo, 
      formaPago || 'Contado', 
      presupuesto || null,
      infoUsado || null, 
      entrega ? 1 : 0, 
      fecha || new Date().toISOString().split('T')[0], 
      fuente || 'otro', 
      vendedor || null, 
      notas || '', 
      'nuevo',
      req.user.id
    ]);

    const leadId = leadResult.rows[0].id;

    await client.query(
      'INSERT INTO lead_history ("leadId", estado, usuario) VALUES ($1, $2, $3)',
      [leadId, 'nuevo', req.user.name]
    );

    const createdLead = await client.query(`
      SELECT l.*, u.name as "vendedorNombre" 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      WHERE l.id = $1
    `, [leadId]);

    await client.query('COMMIT');
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
  const updateData = req.body;

  const pool = getDB();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentLeadResult = await client.query('SELECT * FROM leads WHERE id = $1', [id]);
    
    if (currentLeadResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const currentLead = currentLeadResult.rows[0];

    // Preparar valores finales (usar actuales si no se proporcionan nuevos)
    const finalData = {
      nombre: updateData.nombre !== undefined ? updateData.nombre : currentLead.nombre,
      telefono: updateData.telefono !== undefined ? updateData.telefono : currentLead.telefono,
      email: updateData.email !== undefined ? updateData.email : currentLead.email,
      modelo: updateData.modelo !== undefined ? updateData.modelo : currentLead.modelo,
      formaPago: updateData.formaPago !== undefined ? updateData.formaPago : currentLead.formaPago,
      presupuesto: updateData.presupuesto !== undefined ? updateData.presupuesto : currentLead.presupuesto,
      infoUsado: updateData.infoUsado !== undefined ? updateData.infoUsado : currentLead.infoUsado,
      entrega: updateData.entrega !== undefined ? (updateData.entrega ? 1 : 0) : currentLead.entrega,
      fecha: updateData.fecha !== undefined ? updateData.fecha : currentLead.fecha,
      fuente: updateData.fuente !== undefined ? updateData.fuente : currentLead.fuente,
      vendedor: updateData.vendedor !== undefined ? updateData.vendedor : currentLead.vendedor,
      notas: updateData.notas !== undefined ? updateData.notas : currentLead.notas,
      estado: updateData.estado !== undefined ? updateData.estado : currentLead.estado
    };

    // Si hay cambio de estado, agregar al historial
    if (updateData.estado && currentLead.estado !== updateData.estado) {
      await client.query(
        'INSERT INTO lead_history ("leadId", estado, usuario) VALUES ($1, $2, $3)',
        [id, updateData.estado, req.user.name]
      );
    }

    await client.query(`
      UPDATE leads SET 
        nombre = $1, telefono = $2, email = $3, modelo = $4, "formaPago" = $5, 
        presupuesto = $6, "infoUsado" = $7, entrega = $8, fecha = $9, 
        fuente = $10, vendedor = $11, notas = $12, estado = $13, 
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $14
    `, [
      finalData.nombre, finalData.telefono, finalData.email, finalData.modelo,
      finalData.formaPago, finalData.presupuesto, finalData.infoUsado, finalData.entrega,
      finalData.fecha, finalData.fuente, finalData.vendedor, finalData.notas,
      finalData.estado, id
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

// Eliminar lead individual
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const pool = getDB();
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

// 🆕 BORRADO MASIVO - SOLO OWNER
router.delete('/bulk/delete-all', authenticateToken, authorizeRoles('owner'), async (req, res) => {
  const { confirmPassword } = req.body;

  if (!confirmPassword) {
    return res.status(400).json({ error: 'Se requiere confirmar con contraseña' });
  }

  const pool = getDB();
  const client = await pool.connect();

  try {
    // Verificar contraseña del owner
    const bcrypt = require('bcryptjs');
    const userResult = await client.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const validPassword = await bcrypt.compare(confirmPassword, userResult.rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    await client.query('BEGIN');

    // Obtener conteo antes de borrar
    const countResult = await client.query('SELECT COUNT(*) as total FROM leads');
    const totalLeads = parseInt(countResult.rows[0].total);

    // Eliminar todo el historial primero
    await client.query('DELETE FROM lead_history');
    
    // Eliminar todos los leads
    await client.query('DELETE FROM leads');

    await client.query('COMMIT');

    res.json({ 
      ok: true, 
      message: `${totalLeads} leads eliminados correctamente`,
      deletedCount: totalLeads
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar leads masivamente' });
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