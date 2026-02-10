/**
 * Script de migración: Agregar columna media_type a tmdb_cache
 * 
 * Ejecutar una vez con: node migrate-add-media-type.js
 */

const mysql = require('mysql2/promise');

// Cargar variables de entorno si existe dotenv
try {
  require('dotenv').config();
} catch (e) {
  console.log('ℹ️  dotenv no disponible, usando variables de entorno del sistema');
}

async function migrate() {
  console.log('🔧 Iniciando migración: Agregar media_type a tmdb_cache...\n');
  
  // Leer credenciales de variables de entorno
  const config = {
    host: process.env.MYSQL_HOST || '79.117.135.191',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'railway_app',
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'infinityscrap',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };

  if (!config.password) {
    console.error('❌ Error: MYSQL_PASSWORD no está definida en variables de entorno');
    console.log('\nDefínela con:');
    console.log('  PowerShell: $env:MYSQL_PASSWORD="tu_password"');
    console.log('  CMD: set MYSQL_PASSWORD=tu_password');
    process.exit(1);
  }

  console.log(`Conectando a: ${config.user}@${config.host}:${config.port}/${config.database}\n`);
  
  const mysqlPool = mysql.createPool(config);

  try {
    // Verificar si la columna ya existe
    const [columns] = await mysqlPool.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'tmdb_cache' 
        AND COLUMN_NAME = 'media_type'
    `, [process.env.MYSQL_DATABASE || 'infinityscrap']);

    if (columns.length > 0) {
      console.log('✅ La columna media_type ya existe. No se requiere migración.');
      await mysqlPool.end();
      return;
    }

    console.log('📝 Agregando columna media_type a tmdb_cache...');
    
    // Agregar la columna
    await mysqlPool.execute(`
      ALTER TABLE tmdb_cache 
      ADD COLUMN media_type VARCHAR(20) AFTER title
    `);

    console.log('✅ Columna media_type agregada exitosamente.');
    
    // Opcional: actualizar registros existentes con valores por defecto
    const [cacheRows] = await mysqlPool.execute(`
      SELECT COUNT(*) as total FROM tmdb_cache WHERE media_type IS NULL
    `);
    
    if (cacheRows[0].total > 0) {
      console.log(`\n⚠️  Hay ${cacheRows[0].total} registros sin media_type.`);
      console.log('   Se pueden actualizar manualmente o dejar NULL (se regenerarán).');
    }

    console.log('\n✅ Migración completada exitosamente!\n');

  } catch (error) {
    console.error('❌ Error durante la migración:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await mysqlPool.end();
  }
}

// Ejecutar migración
migrate();
