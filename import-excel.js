const XLSX = require('xlsx');
const axios = require('axios');

const API_URL = 'https://peugeotbackend-production.up.railway.app/api';
const EXCEL_FILE = 'DATOS_PEUGEOT_SEP_2025_para_subir[1].xlsx';

const LOGIN_EMAIL = 'Luca@alluma.com';
const LOGIN_PASSWORD = 'Luca2702';

// Configuración de importación por lotes
const BATCH_SIZE = 10; // Número de leads por lote
const DELAY_BETWEEN_BATCHES = 500; // Milisegundos entre lotes

async function importarLeads() {
  try {
    console.log('📊 Leyendo archivo Excel...');
    
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`✅ ${data.length} registros encontrados\n`);

    console.log('📋 Primeros 3 registros:');
    data.slice(0, 3).forEach((row, i) => {
      console.log(`${i + 1}. ${row.NOMBRE} - ${row.COTACTO} - ${row['CONSULTA POR']}`);
    });
    console.log('');

    console.log('🔐 Autenticando...');
    const loginResponse = await axios.post(`${API_URL}/auth/login`, {
      email: LOGIN_EMAIL,
      password: LOGIN_PASSWORD
    });

    const token = loginResponse.data.token;
    console.log('✅ Autenticado correctamente\n');

    console.log('👥 Obteniendo vendedores...');
    const usersResponse = await axios.get(`${API_URL}/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const vendedores = usersResponse.data.filter(u => 
      u.role === 'vendedor' && u.active === 1
    );

    console.log(`✅ ${vendedores.length} vendedores activos:`);
    vendedores.forEach(v => console.log(`   - ${v.name} (ID: ${v.id})`));
    console.log('');

    if (vendedores.length === 0) {
      console.error('❌ No hay vendedores activos.');
      return;
    }

    // Procesar en lotes para evitar sobrecargar el servidor
    console.log(`📤 Importando en lotes de ${BATCH_SIZE}...\n`);
    let exitosos = 0;
    let errores = 0;
    let vendedorIndex = 0;

    for (let batchStart = 0; batchStart < data.length; batchStart += BATCH_SIZE) {
      const batch = data.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(data.length / BATCH_SIZE);

      console.log(`📦 Lote ${batchNumber}/${totalBatches} (${batch.length} leads)...`);

      // Procesar lote en paralelo
      const promises = batch.map(async (row, index) => {
        const globalIndex = batchStart + index;

        if (!row.NOMBRE || String(row.NOMBRE).trim() === '') {
          return { success: false, index: globalIndex + 1, error: 'Sin nombre' };
        }

        const telefono = row.COTACTO ? String(row.COTACTO).trim() : 'Sin teléfono';
        let modelo = row['CONSULTA POR'] ? String(row['CONSULTA POR']).trim() : 'Peugeot (sin especificar)';
        
        if (modelo.toLowerCase() === 'peugeot' || modelo.toLowerCase().includes('incompleto')) {
          modelo = 'Peugeot (modelo a definir)';
        }

        const vendedor = vendedores[vendedorIndex % vendedores.length];
        vendedorIndex++;

        try {
          const leadData = {
            nombre: String(row.NOMBRE).trim(),
            telefono,
            modelo,
            formaPago: 'Contado',
            infoUsado: null,
            entrega: 0,
            fecha: new Date().toISOString().split('T')[0],
            fuente: 'importacion_excel',
            vendedor: vendedor.id,
            notas: `Importado desde Excel - Septiembre 2025${telefono === 'Sin teléfono' ? '\n⚠️ TELÉFONO INCOMPLETO' : ''}${modelo.includes('a definir') ? '\n⚠️ MODELO INCOMPLETO' : ''}`,
            estado: 'nuevo'
          };

          await axios.post(`${API_URL}/leads`, leadData, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000 // 10 segundos timeout
          });

          return { success: true, index: globalIndex + 1, nombre: row.NOMBRE, vendedor: vendedor.name };
        } catch (error) {
          return { 
            success: false, 
            index: globalIndex + 1, 
            error: error.response?.data?.error || error.message 
          };
        }
      });

      const results = await Promise.all(promises);

      results.forEach(result => {
        if (result.success) {
          exitosos++;
          console.log(`   ✅ ${exitosos}/${data.length} - ${result.nombre} → ${result.vendedor}`);
        } else {
          errores++;
          console.log(`   ❌ Fila ${result.index}: ${result.error}`);
        }
      });

      // Delay entre lotes
      if (batchStart + BATCH_SIZE < data.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    console.log('\n📊 Resumen:');
    console.log(`   ✅ Exitosos: ${exitosos}`);
    console.log(`   ❌ Errores: ${errores}`);
    console.log(`   📝 Total: ${data.length}`);
    console.log(`   📈 Tasa de éxito: ${((exitosos / data.length) * 100).toFixed(1)}%`);

    if (exitosos > 0) {
      console.log('\n🎉 Importación completada!');
    }

  } catch (error) {
    console.error('\n❌ Error general:', error.message);
    if (error.response) {
      console.error('Detalles:', error.response.data);
    }
  }
}

importarLeads();