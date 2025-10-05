const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Obtener todos los leads
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = getDB();
    const [result] = await pool.query(`
      SELECT l.*, u.name as vendedorNombre 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      ORDER BY l.createdAt DESC
    `);
    res.json(result);
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
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [leadResult] = await connection.query(`
      INSERT INTO leads (
        nombre, telefono, email, modelo, formaPago, presupuesto,
        infoUsado, entrega, fecha, fuente, vendedor, notas, estado, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    const leadId = leadResult.insertId;

    await connection.query(
      'INSERT INTO lead_history (leadId, estado, usuario) VALUES (?, ?, ?)',
      [leadId, 'nuevo', req.user.name]
    );

    const [createdLead] = await connection.query(`
      SELECT l.*, u.name as vendedorNombre 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      WHERE l.id = ?
    `, [leadId]);

    await connection.commit();
    res.status(201).json(createdLead[0]);
  } catch (err) {
    await connection.rollback();
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al crear lead' });
  } finally {
    connection.release();
  }
});

// Actualizar lead
router.put('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  const pool = getDB();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [currentLeadResult] = await connection.query('SELECT * FROM leads WHERE id = ?', [id]);
    
    if (currentLeadResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Lead no encontrado' });
    }

    const currentLead = currentLeadResult[0];

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

    if (updateData.estado && currentLead.estado !== updateData.estado) {
      await connection.query(
        'INSERT INTO lead_history (leadId, estado, usuario) VALUES (?, ?, ?)',
        [id, updateData.estado, req.user.name]
      );
    }

    await connection.query(`
      UPDATE leads SET 
        nombre = ?, telefono = ?, email = ?, modelo = ?, formaPago = ?, 
        presupuesto = ?, infoUsado = ?, entrega = ?, fecha = ?, 
        fuente = ?, vendedor = ?, notas = ?, estado = ?
      WHERE id = ?
    `, [
      finalData.nombre, finalData.telefono, finalData.email, finalData.modelo,
      finalData.formaPago, finalData.presupuesto, finalData.infoUsado, finalData.entrega,
      finalData.fecha, finalData.fuente, finalData.vendedor, finalData.notas,
      finalData.estado, id
    ]);

    const [updatedLead] = await connection.query(`
      SELECT l.*, u.name as vendedorNombre 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      WHERE l.id = ?
    `, [id]);

    await connection.commit();
    res.json(updatedLead[0]);
  } catch (err) {
    await connection.rollback();
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al actualizar lead' });
  } finally {
    connection.release();
  }
});

// Eliminar lead individual
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const pool = getDB();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM lead_history WHERE leadId = ?', [id]);
    await connection.query('DELETE FROM leads WHERE id = ?', [id]);
    await connection.commit();
    res.json({ ok: true, message: 'Lead eliminado correctamente' });
  } catch (err) {
    await connection.rollback();
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar lead' });
  } finally {
    connection.release();
  }
});

// BORRADO MASIVO - SOLO OWNER
router.delete('/bulk/delete-all', authenticateToken, authorizeRoles('owner'), async (req, res) => {
  const { confirmPassword } = req.body;

  if (!confirmPassword) {
    return res.status(400).json({ error: 'Se requiere confirmar con contraseña' });
  }

  const pool = getDB();
  const connection = await pool.getConnection();

  try {
    const bcrypt = require('bcryptjs');
    const [userResult] = await connection.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    
    if (userResult.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const validPassword = await bcrypt.compare(confirmPassword, userResult[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    await connection.beginTransaction();

    const [countResult] = await connection.query('SELECT COUNT(*) as total FROM leads');
    const totalLeads = parseInt(countResult[0].total);

    await connection.query('DELETE FROM lead_history');
    await connection.query('DELETE FROM leads');

    await connection.commit();

    res.json({ 
      ok: true, 
      message: `${totalLeads} leads eliminados correctamente`,
      deletedCount: totalLeads
    });
  } catch (err) {
    await connection.rollback();
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al eliminar leads masivamente' });
  } finally {
    connection.release();
  }
});

// Obtener historial de un lead
router.get('/:id/history', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const pool = getDB();
    const [result] = await pool.query(
      'SELECT * FROM lead_history WHERE leadId = ? ORDER BY timestamp DESC',
      [id]
    );
    res.json(result);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Error al obtener historial' });
  }
});

module.exports = router;