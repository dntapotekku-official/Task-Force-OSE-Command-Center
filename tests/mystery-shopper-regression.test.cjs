const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const rules = fs.readFileSync("firestore.rules", "utf8");

// Seluruh JavaScript halaman harus tetap valid secara sintaks.
const scriptStart = html.indexOf("<script>");
const scriptEnd = html.lastIndexOf("</script>");
assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "script utama tidak ditemukan");
new Function(html.slice(scriptStart + 8, scriptEnd));

// Jalankan implementasi skoring yang benar-benar dipakai halaman.
const scoringStart = html.indexOf("const MS_ITEMS = [");
const scoringEnd = html.indexOf("function msMatchOutlet", scoringStart);
assert.ok(scoringStart >= 0 && scoringEnd > scoringStart, "implementasi skoring tidak ditemukan");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  html.slice(scoringStart, scoringEnd) +
  "\nthis.scoreVisit = msVisitScore; this.items = MS_ITEMS;",
  sandbox
);

const best = {
  q1:"Terlihat nyaman dan bersih", q2:"Ada", q3:"Ya, terasa smile voice",
  q4:"Cepat dan tepat", q5:"Ya sangat terbantu dan jelas", q6:"Ya", q7:"Ya", q8:"Ya"
};
const worst = {
  q1:"Kurang menarik dan kotor", q2:"Tidak", q3:"Kurang ramah",
  q4:"Lama dan kurang diperhatikan", q5:"Tidak terbantu", q6:"Tidak", q7:"Tidak", q8:"Tidak"
};
assert.equal(sandbox.scoreVisit(best).score, 100, "jawaban terbaik harus menghasilkan skor 100");
assert.equal(sandbox.scoreVisit(worst).score, 0, "jawaban terburuk harus menghasilkan skor 0");
assert.equal(sandbox.scoreVisit({}).score, null, "jawaban kosong harus menghasilkan No Data");

// Kontrak persistensi: aturan mengizinkan koleksi dan UI menunggu cloud.
assert.match(rules, /allow write:[^;]*'msVisits'/s, "msVisits belum diizinkan untuk ditulis");
assert.match(rules, /allow delete:[^;]*'msVisits'/s, "msVisits belum diizinkan untuk dihapus");
assert.match(html, /await Promise\.all\(\[persistMsVisitDocument\(v\), persistReviewDataDocument\(normalizedVisit\)\]\)[\s\S]*toast\("✓ Kunjungan tersimpan/, "toast sukses harus sesudah persistensi");
assert.match(html, /await Promise\.all\(\[[\s\S]*deleteMsVisitDocument\(id\)[\s\S]*deleteReviewDataDocument\("mystery_gform", id\)[\s\S]*db\.msVisits = db\.msVisits\.filter/, "hapus lokal harus sesudah hapus cloud");

// Preview skor dan filter harus mengikuti kelengkapan/hak akses.
assert.match(html, /answered<MS_ITEMS\.length/, "preview skor harus menunggu semua butir");
assert.match(html, /const scopedVisits = isOutlet\(\)[\s\S]*: isShopper\(\)/, "opsi filter harus dibatasi sesuai pengguna");
assert.match(html, /const APP_VERSION = 15;/, "versi aplikasi harus dinaikkan setelah perubahan persistensi");

console.log("Mystery Shopper regression tests: PASS");
