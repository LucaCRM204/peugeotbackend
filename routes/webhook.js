const express = require('express');
const { getDB } = require('../config/database');

const router = express.Router();

// Función para obtener el siguiente vendedor (rotación)
async function getNextVendedor(connection) {
  try {
    // Obtener todos los vendedores activos (rol 'vendedor' o 'admin')
    const [vendedores] = await connection.query(`
      SELECT id, name 
      FROM users 
      WHERE role IN ('vendedor', 'admin') 
      AND active = 1
      ORDER BY id ASC
    `);

    if (vendedores.length === 0) {
      return null; // No hay vendedores disponibles
    }

    // Obtener el último vendedor asignado
    const [lastAssigned] = await connection.query(`
      SELECT vendedor 
      FROM leads 
      WHERE vendedor IS NOT NULL 
      ORDER BY id DESC 
      LIMIT 1
    `);

    if (lastAssigned.length === 0) {
      // Si no hay leads previos, asignar al primer vendedor
      return vendedores[0].id;
    }

    const lastVendedorId = lastAssigned[0].vendedor;
    
    // Encontrar el índice del último vendedor asignado
    const currentIndex = vendedores.findIndex(v => v.id === lastVendedorId);
    
    // Obtener el siguiente vendedor (circular)
    const nextIndex = (currentIndex + 1) % vendedores.length;
    
    return vendedores[nextIndex].id;

  } catch (err) {
    console.error('Error al obtener siguiente vendedor:', err);
    return null;
  }
}

// Webhook para recibir leads desde Zapier (Meta/Facebook)
router.post('/zapier/meta-lead', async (req, res) => {
  try {
    const {
      nombre, telefono, email, modelo, formaPago, presupuesto,
      infoUsado, entrega, fuente, vendedor, notas,
      full_name, phone_number, email_address, vehicle_model,
      budget, trade_in_info, additional_info
    } = req.body;

    const leadData = {
      nombre: nombre || full_name || 'Sin nombre',
      telefono: telefono || phone_number || 'Sin teléfono',
      email: email || email_address || null,
      modelo: modelo || vehicle_model || 'No especificado',
      formaPago: formaPago || 'Contado',
      presupuesto: presupuesto || budget || null,
      infoUsado: infoUsado || trade_in_info || null,
      entrega: entrega ? 1 : 0,
      fecha: new Date().toISOString().split('T')[0],
      fuente: fuente || 'meta',
      vendedor: vendedor || null, // Se asignará automáticamente si es null
      notas: notas || additional_info || 'Lead recibido desde Meta vía Zapier',
      estado: 'nuevo',
      created_by: 1
    };

    if (!leadData.nombre || leadData.nombre === 'Sin nombre') {
      return res.status(400).json({ 
        success: false,
        error: 'El nombre es obligatorio' 
      });
    }

    if (!leadData.telefono || leadData.telefono === 'Sin teléfono') {
      return res.status(400).json({ 
        success: false,
        error: 'El teléfono es obligatorio' 
      });
    }

    const pool = getDB();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // Si no se especificó vendedor, asignar automáticamente de forma rotativa
      if (!leadData.vendedor) {
        leadData.vendedor = await getNextVendedor(connection);
      }

      const [leadResult] = await connection.query(`
        INSERT INTO leads (
          nombre, telefono, email, modelo, formaPago, presupuesto,
          infoUsado, entrega, fecha, fuente, vendedor, notas, estado, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        leadData.nombre, leadData.telefono, leadData.email, leadData.modelo,
        leadData.formaPago, leadData.presupuesto, leadData.infoUsado,
        leadData.entrega, leadData.fecha, leadData.fuente, leadData.vendedor,
        leadData.notas, leadData.estado, leadData.created_by
      ]);

      const leadId = leadResult.insertId;

      await connection.query(
        'INSERT INTO lead_history (leadId, estado, usuario) VALUES (?, ?, ?)',
        [leadId, 'nuevo', 'Sistema Zapier']
      );

      const [createdLead] = await connection.query(`
        SELECT l.*, u.name as vendedorNombre 
        FROM leads l 
        LEFT JOIN users u ON l.vendedor = u.id 
        WHERE l.id = ?
      `, [leadId]);

      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'Lead creado exitosamente desde Meta',
        lead: createdLead[0],
        leadId: leadId,
        assignedTo: createdLead[0].vendedorNombre || 'Sin asignar'
      });

    } catch (err) {
      await connection.rollback();
      console.error('Error al crear lead desde Zapier:', err);
      res.status(500).json({ 
        success: false,
        error: 'Error al crear lead en la base de datos' 
      });
    } finally {
      connection.release();
    }

  } catch (err) {
    console.error('Error en webhook de Zapier:', err);
    res.status(500).json({ 
      success: false,
      error: 'Error interno del servidor' 
    });
  }
});

router.get('/zapier/test', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook endpoint está funcionando',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;