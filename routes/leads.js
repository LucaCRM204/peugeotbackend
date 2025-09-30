const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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

  console.log('📥 Lead recibido del bot:');
  console.log('   - Nombre:', nombre);
  console.log('   - Vendedor ID:', vendedor);
  console.log('   - Fuente:', fuente);

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
        "infoUsado", entrega, fecha, fuente, vendedor, notas, estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
    `, [
      nombre, telefono, email, modelo, formaPago, presupuesto,
      infoUsado, entrega ? 1 : 0, fecha, fuente || 'otro', vendedor, notas || '', 'nuevo'
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
    infoUsado, entrega, fecha, fuente, vendedor, notas, estado
  } = req.body;

  const pool = getDB();
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
      infoUsado, entrega ? 1 : 0, fecha, fuente, vendedor, notas, estado, id
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

// Eliminar lead
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