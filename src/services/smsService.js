const axios = require("axios");
const pool = require("../db");

/**
 * NetGSM üzerinden gerçek SMS gönderimi.
 */
async function sendViaProvider(telefon, mesaj, netgsmBilgileri) {
  const { netgsm_usercode, netgsm_password, netgsm_msgheader } =
    netgsmBilgileri || {};

  try {
    const response = await axios.get("https://api.netgsm.com.tr/sms/send/get", {
      params: {
        usercode: netgsm_usercode,
        password: netgsm_password,
        gsmno: telefon,
        message: mesaj,
        msgheader: netgsm_msgheader,
      },
    });
    // NetGSM başarılı gönderimde "00" veya "01" ile başlayan bir kod döner
    const basarili = /^0[01]/.test(String(response.data).trim());
    return { basarili, raw: response.data };
  } catch (err) {
    console.error("SMS gönderim hatası:", err.message);
    return { basarili: false, hata: err.message };
  }
}

/**
 * Kota kontrolü yapıp SMS gönderen ve logu tutan ana fonksiyon.
 * Uygulamadaki TÜM SMS gönderimleri bu fonksiyondan geçmeli.
 *
 * @param {number} berberId
 * @param {number|null} musteriId
 * @param {'onay'|'hatirlatma'} tip
 * @param {string} mesaj
 */
async function smsGonder(berberId, musteriId, tip, mesaj) {
  const berberRes = await pool.query(
    `SELECT sms_kotasi_toplam, sms_kotasi_kullanilan, netgsm_usercode, netgsm_password, netgsm_msgheader
         FROM berber WHERE id = $1`,
    [berberId],
  );

  if (berberRes.rows.length === 0) {
    throw new Error("Berber bulunamadı");
  }

  const berberBilgi = berberRes.rows[0];
  const netgsmBilgisiVar = !!(
    berberBilgi.netgsm_usercode &&
    berberBilgi.netgsm_password &&
    berberBilgi.netgsm_msgheader
  );

  // NetGSM bilgisi hiç girilmemişse: gerçek bir deneme yapılmıyor, log kalabalığı olmaması için
  // sms_log'a hiçbir şey yazmadan sessizce dönüyoruz.
  if (!netgsmBilgisiVar) {
    return { basarili: false, sebep: "netgsm_bilgisi_yok" };
  }

  if (berberBilgi.sms_kotasi_kullanilan >= berberBilgi.sms_kotasi_toplam) {
    await pool.query(
      `INSERT INTO sms_log (berber_id, musteri_id, tip, mesaj, durum)
             VALUES ($1, $2, $3, $4, 'kota_doldu')`,
      [berberId, musteriId, tip, mesaj],
    );
    return { basarili: false, sebep: "kota_doldu" };
  }

  let telefon = null;
  if (musteriId) {
    const musteriRes = await pool.query(
      "SELECT telefon FROM musteri WHERE id = $1",
      [musteriId],
    );
    telefon = musteriRes.rows[0]?.telefon;
  }

  // Bilgiler girilmiş -> gerçek deneme yapılıyor, sonucu (başarılı ya da başarısız) loglanıyor
  const sonuc = await sendViaProvider(telefon, mesaj, berberBilgi);

  await pool.query(
    `INSERT INTO sms_log (berber_id, musteri_id, tip, mesaj, durum)
         VALUES ($1, $2, $3, $4, $5)`,
    [
      berberId,
      musteriId,
      tip,
      mesaj,
      sonuc.basarili ? "gonderildi" : "basarisiz",
    ],
  );

  if (sonuc.basarili) {
    await pool.query(
      "UPDATE berber SET sms_kotasi_kullanilan = sms_kotasi_kullanilan + 1 WHERE id = $1",
      [berberId],
    );
  }

  return sonuc;
}

module.exports = { smsGonder };
