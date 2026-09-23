# Berber Randevu Uygulaması - Backend

## Kurulum

```bash
npm install
cp .env.example .env
# .env dosyasını kendi DATABASE_URL ve SMS bilgilerinle doldur
npm run migrate   # veritabanı tablolarını oluşturur
npm run dev       # geliştirme modunda başlatır (nodemon)
```

## Klasör Yapısı

```
src/
  db.js                    -> PostgreSQL bağlantı havuzu
  schema.sql               -> veritabanı tabloları
  migrate.js               -> schema.sql'i veritabanına uygular
  server.js                -> Express uygulaması giriş noktası
  routes/
    berber.js               -> kayıt, giriş, abonelik/kota durumu
    musteri.js               -> müşteri kaydı (+ hoşgeldin SMS)
    randevu.js               -> dolu saatler, randevu oluşturma (+ onay SMS), iptal, listeleme
  services/
    smsService.js            -> tüm SMS gönderimlerinin geçtiği tek nokta (kota kontrollü)
    subscriptionService.js   -> dönem/abonelik yenileme-durdurma mantığı
  middleware/
    auth.js                  -> ŞİMDİLİK basit header tabanlı kimlik doğrulama (bkz. not aşağıda)
    subscriptionCheck.js     -> her istekte abonelik aktif mi kontrolü
  jobs/
    reminderJob.js            -> her 5 dakikada bir: randevudan 2 saat önce hatırlatma SMS
    subscriptionJob.js        -> her gün 00:00: dönemi dolan berberleri yenile/durdur
```

## Önemli Notlar / Sıradaki Adımlar

1. **auth.js şu an geçici bir çözüm.** Mobil uygulama isteklerde `X-Berber-Id` header'ı gönderiyor
   varsayımıyla çalışıyor. Üretime geçmeden önce telefon+şifre ile login yapıp JWT token
   dönen gerçek bir auth sistemine çevirmemiz gerekiyor.
2. **Ödeme entegrasyonu henüz yok.** `odeme_bu_donem_alindi` alanı şu an manuel olarak
   (örn. senin admin panelinden veya doğrudan veritabanından) TRUE yapılmalı. İleride
   iyzico/PayTR entegrasyonu bu alanı otomatik güncelleyecek.
3. **SMS sağlayıcısı NetGSM için hazırlandı.** `.env` içindeki `SMS_PROVIDER=netgsm` olmadığı
   sürece SMS'ler gerçekte gönderilmez, konsola yazdırılır (test modu).
4. Basit test için:
   ```bash
   curl -X POST http://localhost:3000/api/berber/kayit \
     -H "Content-Type: application/json" \
     -d '{"ad":"Ahmet Usta","telefon":"5551234567","sifre":"1234"}'
   ```

## API Uç Noktaları (Özet)

| Method | Endpoint | Açıklama |
|---|---|---|
| POST | /api/berber/kayit | Yeni berber kaydı (deneme sürümü başlar) |
| POST | /api/berber/giris | Giriş |
| GET | /api/berber/durum | Abonelik/kota durumu |
| POST | /api/musteri | Müşteri kaydı (+ hoşgeldin SMS) |
| GET | /api/musteri | Müşteri listesi |
| GET | /api/randevu/dolu-saatler?tarih=YYYY-MM-DD | O gün dolu saatler |
| POST | /api/randevu | Randevu oluştur (+ onay SMS) |
| PATCH | /api/randevu/:id/iptal | Randevu iptali |
| GET | /api/randevu?tarih=YYYY-MM-DD | Randevu listesi |
