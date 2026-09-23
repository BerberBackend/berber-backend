require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    try {
        await pool.query(schema);
        console.log('✅ Veritabanı şeması başarıyla uygulandı.');
    } catch (err) {
        console.error('❌ Migrasyon hatası:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

migrate();
