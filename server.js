const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Importar configuración de base de datos
const { initDatabase } = require('./config/database');

// Importar rutas
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const leadRoutes = require('./routes/leads');
const webhookRoutes = require('./routes/webhook');
const presupuestosRoutes = require('./routes/presupuestos');
const metasRoutes = require('./routes/metas');
const notasInternasRoutes = require('./routes/notasInternas');

const app = express();
const PORT = process.env.PORT || 8080;

// Configurar trust proxy
app.set('trust proxy', 1);

// ============================================
// RATE LIMITING
// ============================================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100 // límite de 100 requests por IP cada 15 minutos
});

// Rate limiting más permisivo para webhooks
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300 // Más solicitudes permitidas para webhooks
});

// ============================================
// CORS CONFIGURATION
// ============================================
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://www.crm3alluma.com.ar',
  'https://crm3alluma.com.ar'
];

app.use(cors({
  origin: function(origin, callback) {
    // Permitir requests sin origin (Postman, curl, apps móviles, webhooks)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('❌ CORS bloqueado para origen:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// ============================================
// MIDDLEWARES GLOBALES
// ============================================
app.use(helmet({
  contentSecurityPolicy: false, // Desactivar CSP si causa problemas con frontend
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// RUTAS API
// ============================================

// Rutas de autenticación (sin rate limit estricto)
app.use('/api/auth', authRoutes);

// Rutas protegidas con rate limiting
app.use('/api/users', limiter, userRoutes);
app.use('/api/leads', limiter, leadRoutes);
app.use('/api/presupuestos', limiter, presupuestosRoutes);
app.use('/api/metas', limiter, metasRoutes);
app.use('/api/notas-internas', limiter, notasInternasRoutes);

// Webhooks con rate limiting permisivo
app.use('/api/webhook', webhookLimiter, webhookRoutes);

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Peugeot CRM API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ============================================
// ENDPOINT DE PRUEBA
// ============================================
app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API funcionando correctamente',
    routes: {
      auth: '/api/auth',
      users: '/api/users',
      leads: '/api/leads',
      presupuestos: '/api/presupuestos',
      metas: '/api/metas',
      notasInternas: '/api/notas-internas',
      webhook: '/api/webhook'
    }
  });
});

// ============================================
// MANEJO DE ERRORES 404
// ============================================
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method
  });
});

// ============================================
// MANEJO DE ERRORES GLOBAL
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);
  
  // Error de CORS
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS error',
      message: 'Origen no permitido'
    });
  }
  
  // Error de sintaxis JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'JSON inválido',
      message: err.message
    });
  }
  
  // Error genérico
  res.status(err.status || 500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Ha ocurrido un error'
  });
});

// ============================================
// INICIALIZAR BASE DE DATOS Y SERVIDOR
// ============================================
initDatabase()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n' + '='.repeat(60));
      console.log('✅ Peugeot CRM API iniciado correctamente');
      console.log('='.repeat(60));
      console.log(`🚀 Servidor corriendo en puerto: ${PORT}`);
      console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}`);
      console.log(`📡 Webhook endpoint: http://localhost:${PORT}/api/webhook/zapier/meta-lead`);
      console.log(`🔒 CORS habilitado para: ${allowedOrigins.join(', ')}`);
      console.log('='.repeat(60));
      console.log('\n📋 Rutas disponibles:');
      console.log('   - POST   /api/auth/login');
      console.log('   - POST   /api/auth/logout');
      console.log('   - GET    /api/users');
      console.log('   - POST   /api/users');
      console.log('   - PUT    /api/users/:id');
      console.log('   - DELETE /api/users/:id');
      console.log('   - GET    /api/leads');
      console.log('   - POST   /api/leads');
      console.log('   - PUT    /api/leads/:id');
      console.log('   - DELETE /api/leads/:id');
      console.log('   - GET    /api/presupuestos');
      console.log('   - POST   /api/presupuestos');
      console.log('   - PUT    /api/presupuestos/:id');
      console.log('   - DELETE /api/presupuestos/:id');
      console.log('   - GET    /api/metas');
      console.log('   - POST   /api/metas');
      console.log('   - PUT    /api/metas/:id');
      console.log('   - DELETE /api/metas/:id');
      console.log('   - GET    /api/notas-internas/lead/:leadId');
      console.log('   - POST   /api/notas-internas');
      console.log('   - DELETE /api/notas-internas/:id');
      console.log('   - POST   /api/webhook/zapier/meta-lead');
      console.log('   - GET    /api/health');
      console.log('   - GET    /api/test');
      console.log('='.repeat(60) + '\n');
    });
  })
  .catch(err => {
    console.error('\n' + '='.repeat(60));
    console.error('❌ ERROR CRÍTICO: No se pudo inicializar la base de datos');
    console.error('='.repeat(60));
    console.error(err);
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  });

// ============================================
// MANEJO DE SEÑALES DE TERMINACIÓN
// ============================================
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM recibido. Cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT recibido. Cerrando servidor...');
  process.exit(0);
});

// ============================================
// MANEJO DE ERRORES NO CAPTURADOS
// ============================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

module.exports = app;