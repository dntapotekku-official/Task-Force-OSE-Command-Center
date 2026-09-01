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

// Link video diuji secara executable agar nilai kosong tidak menghasilkan badge palsu.
const validVideoStart = html.indexOf("function validMsVideos");
const validVideoEnd = html.indexOf("function renderMystery", validVideoStart);
const videoInputStart = html.indexOf("function driveToPreview");
const videoInputEnd = html.indexOf("function msfCollectAnswers", videoInputStart);
assert.ok(validVideoStart >= 0 && validVideoEnd > validVideoStart, "filter video tidak ditemukan");
assert.ok(videoInputStart >= 0 && videoInputEnd > videoInputStart, "parser input video tidak ditemukan");
const videoSandbox = {};
vm.createContext(videoSandbox);
vm.runInContext(
  html.slice(validVideoStart, validVideoEnd) + html.slice(videoInputStart, videoInputEnd) +
  "\nthis.validVideos=validMsVideos; this.parseVideos=msVideosFromInput;",
  videoSandbox
);
assert.equal(videoSandbox.validVideos([{name:"Video 1",url:""}]).length, 0, "URL video kosong tidak boleh dihitung");
assert.equal(videoSandbox.validVideos([{url:"   "},{url:"https://video.test/1"}]).length, 1, "hanya URL terisi yang dihitung");
assert.equal(videoSandbox.parseVideos("").length, 0, "input video kosong harus menghasilkan array kosong");
assert.equal(videoSandbox.parseVideos(" ,  , ").length, 0, "input koma kosong harus menghasilkan array kosong");
assert.equal(videoSandbox.parseVideos("https://video.test/1, https://video.test/2").length, 2, "dua URL harus menghasilkan dua video");

// Render tabel diuji dengan DOM mock lokal; tidak memuat halaman/Firebase production.
const renderStart = html.indexOf("function canEditMsVisit");
const renderEnd = html.indexOf("function openMsDetail", renderStart);
const renderSandbox = {
  currentUser:{role:"admin",user:"tester"},
  db:{msVisits:[]},
  isOutlet:()=>false, isShopper:()=>false,
  ssRefresh(){}, monthLabelID:v=>v, fmtDate:v=>v,
  shortOutletName:v=>v, esc:v=>String(v??""),
  msScoreChip:()=>"<span>100</span>", openMsForm(){}, openMsDetail(){},
  nodes:{
    msBody:{innerHTML:""}, msOutlet:{value:"",innerHTML:""},
    msBulanF:{value:"all",innerHTML:""}, msSummary:{textContent:""}, cntMs:{textContent:""}
  }
};
renderSandbox.visibleMsVisits = ()=>renderSandbox.db.msVisits;
renderSandbox.$ = selector=>renderSandbox.nodes[selector.slice(1)];
renderSandbox.$$ = ()=>[];
vm.createContext(renderSandbox);
vm.runInContext(html.slice(renderStart, renderEnd)+"\nthis.render=renderMystery;", renderSandbox);
renderSandbox.db.msVisits = [{id:"ms-test",tanggal:"2026-09-01",outlet:"Outlet Test",score:100,videos:[{name:"Video 1",url:""}]}];
renderSandbox.render();
assert.match(renderSandbox.nodes.msBody.innerHTML, /<span class="muted">-<\/span>/, "bukti kosong harus dirender sebagai strip");
assert.doesNotMatch(renderSandbox.nodes.msBody.innerHTML, /🎥 1/, "video kosong tidak boleh menampilkan badge");
assert.match(renderSandbox.nodes.msBody.innerHTML, /ms-edit-btn/, "admin harus melihat tombol edit pada row");
renderSandbox.db.msVisits[0].videos = [{name:"Video 1",url:"https://video.test/1"}];
renderSandbox.render();
assert.match(renderSandbox.nodes.msBody.innerHTML, /🎥 1/, "satu URL valid harus menampilkan badge satu video");

// Kebijakan retry upload diuji tanpa request jaringan.
const retryStatusStart = html.indexOf("function retryableUploadStatus");
const retryStatusEnd = html.indexOf("async function fetchUploadWithRetry", retryStatusStart);
const uploadSandbox = {};
vm.createContext(uploadSandbox);
vm.runInContext(html.slice(retryStatusStart, retryStatusEnd)+"\nthis.retryable=retryableUploadStatus;", uploadSandbox);
assert.equal(uploadSandbox.retryable(408), true, "timeout upload harus dicoba ulang");
assert.equal(uploadSandbox.retryable(429), true, "rate limit upload harus dicoba ulang");
assert.equal(uploadSandbox.retryable(503), true, "gangguan server upload harus dicoba ulang");
assert.equal(uploadSandbox.retryable(400), false, "request upload tidak valid tidak boleh diulang tanpa batas");

// Kontrak persistensi: aturan mengizinkan koleksi dan UI menunggu cloud.
assert.match(rules, /allow write:[^;]*'msVisits'/s, "msVisits belum diizinkan untuk ditulis");
assert.match(rules, /allow delete:[^;]*'msVisits'/s, "msVisits belum diizinkan untuk dihapus");
assert.match(html, /await Promise\.all\(\[persistMsVisitDocument\(v\), persistReviewDataDocument\(normalizedVisit\)\]\)[\s\S]*toast\("✓ Kunjungan /, "toast sukses harus sesudah persistensi");
assert.match(html, /await Promise\.all\(\[[\s\S]*deleteMsVisitDocument\(id\)[\s\S]*deleteReviewDataDocument\("mystery_gform", id\)[\s\S]*db\.msVisits = db\.msVisits\.filter/, "hapus lokal harus sesudah hapus cloud");

// Preview skor dan filter harus mengikuti kelengkapan/hak akses.
assert.match(html, /answered<MS_ITEMS\.length/, "preview skor harus menunggu semua butir");
assert.match(html, /const scopedVisits = isOutlet\(\)[\s\S]*: isShopper\(\)/, "opsi filter harus dibatasi sesuai pengguna");
assert.match(html, /class="mini-act ms-edit-btn"/, "setiap row yang berhak harus memiliki tombol edit");
assert.match(html, /function openMsForm\(id=null\)[\s\S]*editingMsVisitId = visit \? visit\.id : null/, "form harus mendukung mode edit");
assert.match(html, /visit\.skenario[\s\S]*msfSkenario[\s\S]*insertAdjacentHTML/, "skenario lama di luar opsi standar harus tetap dipertahankan");
assert.match(html, /if\(existing\) db\.msVisits\[db\.msVisits\.findIndex/, "edit harus memperbarui row, bukan menambah duplikat");
assert.match(html, /persistMsVisitDocument\(v\), persistReviewDataDocument\(normalizedVisit\)/, "edit harus menyinkronkan kunjungan dan review terkait");
assert.match(html, /id="msfFotoRemove"[\s\S]*msFotoData = ""/, "form edit harus dapat menghapus foto lama");
assert.match(html, /existing\.fotoUrl!==v\.fotoUrl\) gcsDeleteByUrl/, "objek foto lama harus dibersihkan setelah perubahan tersimpan");
assert.match(html, /function validMsVideos\(videos\)[\s\S]*String\(f\.url\|\|""\)\.trim\(\)/, "video tanpa URL tidak boleh dianggap sebagai bukti");
assert.match(html, /const validVideos = validMsVideos\(v\.videos\)[\s\S]*validVideos\.length/, "badge video harus menghitung URL yang benar-benar terisi");
assert.match(html, /evidence\|\|'<span class="muted">-<\/span>'/, "kolom bukti kosong harus ditampilkan sebagai tanda strip");
assert.match(html, /waitForFirebaseAuth\(\)[\s\S]*fetchUploadWithRetry\(cfg\.signEndpoint/, "upload harus menunggu auth dan memakai retry");
assert.match(html, /signEndpoint===GCS_SIGNER_LEGACY[\s\S]*GCS_SIGNER_DEFAULT/, "endpoint signer 404 harus dimigrasikan ke mode SDK");
assert.match(html, /catch\(signerError\)[\s\S]*gcsUploadViaFirebaseSdk\(dataUrl,path\)/, "kegagalan signer kustom harus mencoba Firebase Storage SDK");
assert.match(html, /gcsUploadViaFirebaseSdk[\s\S]*getDownloadURL[\s\S]*Firebase Storage tidak mengembalikan URL foto/, "mode SDK harus memverifikasi URL hasil upload");
assert.match(html, /fetchUploadWithRetry\(url, options, attempts=3\)[\s\S]*new AbortController\(\)/, "request upload harus memiliki timeout dan retry terbatas");
assert.match(html, /if\(msFotoUploading\)[\s\S]*Tunggu proses foto selesai/, "form tidak boleh disimpan saat foto masih diproses");
assert.match(html, /fotoPendingUpload:msFotoPending/, "status fallback foto Mystery Shopper harus disimpan");
assert.match(html, /img\.onerror[\s\S]*rd\.onerror/, "kegagalan membaca dan mendekode foto harus ditangani");
assert.doesNotMatch(html, /Koneksi upload terganggu — foto disimpan sementara/, "foto baru tidak boleh dianggap berhasil melalui fallback sementara");
assert.match(html, /processPhoto\(file, cb, ctx, onError\)[\s\S]*Storage tidak mengembalikan URL foto[\s\S]*if\(onError\) onError\(e\)/, "upload foto wajib menghasilkan URL Storage atau error");
assert.match(html, /fotoUploadFailed\|\|fotoTemuanUploadFailed[\s\S]*Upload foto belum berhasil/, "form temuan harus tetap terbuka setelah upload foto gagal");
assert.match(html, /if\(msFotoUploadFailed\)[\s\S]*Upload foto belum berhasil/, "form Mystery Shopper harus tetap terbuka setelah upload foto gagal");
assert.match(html, /persistItemDocument[\s\S]*closeModal\(\); renderAll\(\); toast\(successMessage\)/, "modal temuan hanya boleh ditutup dan sukses setelah persistensi");
assert.match(html, /persistMsVisitDocument\(v\)[\s\S]*msFormBack[\s\S]*toast\("✓ Kunjungan /, "modal Mystery Shopper hanya boleh ditutup dan sukses setelah persistensi");
assert.match(html, /item-conflict[\s\S]*Modal tetap terbuka; periksa lalu simpan ulang/, "konflik penyimpanan tidak boleh menutup modal sebagai sukses");
assert.match(html, /const APP_VERSION = 16;/, "versi aplikasi harus dinaikkan setelah perubahan persistensi");

console.log("Mystery Shopper regression tests: PASS");
