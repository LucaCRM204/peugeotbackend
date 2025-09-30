const express = require('express');
const { getDB } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Obtener todos los leads
router.get('/', authenticateToken, (req, res) => {
  const db = getDB();
  db.all(`
    SELECT l.*, u.name as vendedorNombre 
    FROM leads l 
    LEFT JOIN users u ON l.vendedor = u.id 
    ORDER BY l.createdAt DESC
  `, (err, leads) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error al obtener leads' });
    }
    res.json(leads);
  });
});

// Crear lead
router.post('/', authenticateToken, (req, res) => {
  const {
    nombre, telefono, email, modelo, formaPago, presupuesto,
    infoUsado, entrega, fecha, fuente, vendedor, notas
  } = req.body;

  // 👇 LOG PARA DEBUG
  console.log('📥 Lead recibido del bot:');
  console.log('   - Nombre:', nombre);
  console.log('   - Vendedor ID:', vendedor);
  console.log('   - Fuente:', fuente);

  if (!nombre || !telefono || !modelo) {
    return res.status(400).json({ error: 'Nombre, teléfono y modelo son obligatorios' });
  }

  const db = getDB();
  db.run(`
    INSERT INTO leads (
      nombre, telefono, email, modelo, formaPago, presupuesto,
      infoUsado, entrega, fecha, fuente, vendedor, notas, estado
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    nombre, 
    telefono, 
    email || null, 
    modelo, 
    formaPago || null, 
    presupuesto || null,
    infoUsado || null, 
    entrega ? 1 : 0, 
    fecha || null, 
    fuente || 'otro', 
    vendedor || null,  // 👈 ASEGURARSE QUE SE GUARDE
    notas || '',
    'nuevo'  // 👈 MOVIDO AL ARRAY DE PARÁMETROS
  ], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error al crear lead' });
    }

    console.log('✅ Lead guardado con ID:', this.lastID);

    // Agregar al historial
    db.run(
      'INSERT INTO lead_history (leadId, estado, usuario) VALUES (?, ?, ?)',
      [this.lastID, 'nuevo', req.user.name]
    );

    // Obtener el lead creado
    db.get(`
      SELECT l.*, u.name as vendedorNombre 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      WHERE l.id = ?
    `, [this.lastID], (err, lead) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error al obtener lead creado' });
      }
      
      // 👇 LOG PARA VERIFICAR
      console.log('📤 Lead retornado - Vendedor:', lead.vendedor, '-', lead.vendedorNombre);
      
      res.status(201).json(lead);
    });
  });
});

// Actualizar lead
router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const {
    nombre, telefono, email, modelo, formaPago, presupuesto,
    infoUsado, entrega, fecha, fuente, vendedor, notas, estado
  } = req.body;

  const db = getDB();
  
  // Si hay cambio de estado, agregar al historial
  if (estado) {
    db.get('SELECT estado FROM leads WHERE id = ?', [id], (err, currentLead) => {
      if (!err && currentLead && currentLead.estado !== estado) {
        db.run(
          'INSERT INTO lead_history (leadId, estado, usuario) VALUES (?, ?, ?)',
          [id, estado, req.user.name]
        );
      }
    });
  }

  db.run(`
    UPDATE leads SET 
      nombre = ?, telefono = ?, email = ?, modelo = ?, formaPago = ?, 
      presupuesto = ?, infoUsado = ?, entrega = ?, fecha = ?, 
      fuente = ?, vendedor = ?, notas = ?, estado = ?, 
      updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    nombre, telefono, email, modelo, formaPago, presupuesto,
    infoUsado, entrega ? 1 : 0, fecha, fuente, vendedor, notas, estado, id
  ], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error al actualizar lead' });
    }

    db.get(`
      SELECT l.*, u.name as vendedorNombre 
      FROM leads l 
      LEFT JOIN users u ON l.vendedor = u.id 
      WHERE l.id = ?
    `, [id], (err, lead) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error al obtener lead actualizado' });
      }
      res.json(lead);
    });
  });
});

// Eliminar lead
router.delete('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const db = getDB();

  db.run('DELETE FROM lead_history WHERE leadId = ?', [id]);
  db.run('DELETE FROM leads WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Error al eliminar lead' });
    }
    res.json({ ok: true, message: 'Lead eliminado correctamente' });
  });
});

// Obtener historial de un lead
router.get('/:id/history', authenticateToken, (req, res) => {
  const { id } = req.params;
  const db = getDB();

  db.all(
    'SELECT * FROM lead_history WHERE leadId = ? ORDER BY timestamp DESC',
    [id],
    (err, history) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Error al obtener historial' });
      }
      res.json(history);
    }
  );
});

module.exports = router;