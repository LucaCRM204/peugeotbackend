const express = require('express');
const { getDB } = require('../config/database');

const router = express.Router();

// Webhook para recibir leads desde Zapier (Meta/Facebook)
router.post('/zapier/meta-lead', async (req, res) => {
  try {
    const {
      nombre,
      telefono,
      email,
      modelo,
      formaPago,
      presupuesto,
      infoUsado,
      entrega,
      fuente,
      vendedor,
      notas,
      // Campos adicionales que puede enviar Meta
      full_name,
      phone_number,
      email_address,
      vehicle_model,
      budget,
      trade_in_info,
      additional_info
    } = req.body;

    // Mapear campos de Meta a tu estructura
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
      fuente: fuente || 'meta', // Identificar que viene de Meta
      vendedor: vendedor || null,
      notas: notas || additional_info || 'Lead recibido desde Meta vía Zapier',
      estado: 'nuevo',
      created_by: 1 // ID del usuario sistema (ajustar según tu configuración)
    };

    // Validar campos obligatorios
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

      // Insertar el lead
      const [leadResult] = await connection.query(`
        INSERT INTO leads (
          nombre, telefono, email, modelo, formaPago, presupuesto,
          infoUsado, entrega, fecha, fuente, vendedor, notas, estado, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        leadData.nombre,
        leadData.telefono,
        leadData.email,
        leadData.modelo,
        leadData.formaPago,
        leadData.presupuesto,
        leadData.infoUsado,
        leadData.entrega,
        leadData.fecha,
        leadData.fuente,
        leadData.vendedor,
        leadData.notas,
        leadData.estado,
        leadData.created_by
      ]);

      const leadId = leadResult.insertId;

      // Registrar en historial
      await connection.query(
        'INSERT INTO lead_history (leadId, estado, usuario) VALUES (?, ?, ?)',
        [leadId, 'nuevo', 'Sistema Zapier']
      );

      // Obtener el lead creado con toda la información
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
        leadId: leadId
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

// Endpoint de verificación (útil para testing)
router.get('/zapier/test', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook endpoint está funcionando',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;