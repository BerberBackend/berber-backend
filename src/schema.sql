-- Berber randevu uygulaması veritabanı şeması

CREATE TABLE IF NOT EXISTS berber (
    id SERIAL PRIMARY KEY,
    ad VARCHAR(150) NOT NULL,
    telefon VARCHAR(20) NOT NULL UNIQUE,
    sube_adi VARCHAR(150),
    sifre_hash VARCHAR(255) NOT NULL,

    -- Abonelik alanları
    abonelik_durum VARCHAR(20) NOT NULL DEFAULT 'deneme', -- deneme | aktif | durduruldu
    donem_baslangic TIMESTAMP NOT NULL DEFAULT NOW(),
    donem_bitis TIMESTAMP NOT NULL,
    odeme_bu_donem_alindi BOOLEAN NOT NULL DEFAULT FALSE,

    -- SMS kota alanları
    sms_kotasi_toplam INT NOT NULL DEFAULT 500,
    sms_kotasi_kullanilan INT NOT NULL DEFAULT 0,

    -- Berbere ait NetGSM hesap bilgileri (her berber kendi hesabını kullanır)
    netgsm_usercode VARCHAR(50),
    netgsm_password VARCHAR(255),
    netgsm_msgheader VARCHAR(20),

    -- Aynı anda tek oturum kontrolü: en son giriş yapılan cihazın token'ı burada tutulur
    session_token VARCHAR(255),

    olusturma_tarihi TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tablo daha önce oluşturulmuşsa bu kolonları sonradan eklemek için (idempotent, tekrar çalıştırılabilir)
ALTER TABLE berber ADD COLUMN IF NOT EXISTS netgsm_usercode VARCHAR(50);
ALTER TABLE berber ADD COLUMN IF NOT EXISTS netgsm_password VARCHAR(255);
ALTER TABLE berber ADD COLUMN IF NOT EXISTS netgsm_msgheader VARCHAR(20);
ALTER TABLE berber ADD COLUMN IF NOT EXISTS session_token VARCHAR(255);

CREATE TABLE IF NOT EXISTS musteri (
    id SERIAL PRIMARY KEY,
    berber_id INT NOT NULL REFERENCES berber(id) ON DELETE CASCADE,
    ad VARCHAR(150) NOT NULL,
    telefon VARCHAR(20) NOT NULL,
    kayit_tarihi TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (berber_id, telefon)
);

CREATE TABLE IF NOT EXISTS randevu (
    id SERIAL PRIMARY KEY,
    berber_id INT NOT NULL REFERENCES berber(id) ON DELETE CASCADE,
    musteri_id INT NOT NULL REFERENCES musteri(id) ON DELETE CASCADE,
    tarih_saat TIMESTAMP NOT NULL,
    durum VARCHAR(20) NOT NULL DEFAULT 'planlandi', -- planlandi | tamamlandi | iptal
    hatirlatma_gonderildi BOOLEAN NOT NULL DEFAULT FALSE,
    olusturma_tarihi TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Aynı berberde aynı saate iki randevu girilemesin (çakışma engelleme)
    UNIQUE (berber_id, tarih_saat)
);

CREATE TABLE IF NOT EXISTS sms_log (
    id SERIAL PRIMARY KEY,
    berber_id INT NOT NULL REFERENCES berber(id) ON DELETE CASCADE,
    musteri_id INT REFERENCES musteri(id) ON DELETE SET NULL,
    tip VARCHAR(20) NOT NULL, -- hosgeldin | onay | hatirlatma
    mesaj TEXT NOT NULL,
    durum VARCHAR(20) NOT NULL DEFAULT 'gonderildi', -- gonderildi | basarisiz | kota_doldu
    gonderim_tarihi TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_randevu_berber_tarih ON randevu (berber_id, tarih_saat);
CREATE INDEX IF NOT EXISTS idx_randevu_hatirlatma ON randevu (hatirlatma_gonderildi, tarih_saat);
