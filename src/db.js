const { Pool, types } = require("pg");

// Postgres "timestamp without time zone" (OID 1114) değerini node-postgres varsayılan olarak
// UTC kabul edip JS Date'e çeviriyor. Ama bizim randevu saatlerimiz aslında Türkiye yerel
// duvar saati. Bu satır olmadan örn. 09:00 kaydedilen randevu mobilde 12:00 görünüyordu.
// Ham metin olarak bırakınca hiçbir yerde gereksiz TZ dönüşümü olmuyor.
types.setTypeParser(1114, (value) => value);

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // Oturum saat dilimini İstanbul yapıyoruz ki hatırlatma job'ındaki NOW() karşılaştırması
  // (reminderJob.js) da gerçek Türkiye saatiyle tutarlı çalışsın.
  options: "-c TimeZone=Europe/Istanbul",
});

pool.on("error", (err) => {
  console.error("Beklenmeyen veritabanı hatası:", err);
});

module.exports = pool;
