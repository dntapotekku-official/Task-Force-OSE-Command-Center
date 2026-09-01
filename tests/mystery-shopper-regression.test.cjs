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
  canDelete:()=>true, deleteMsVisit(){},
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
assert.match(renderSandbox.nodes.msBody.innerHTML, /ms-delete-btn/, "admin harus melihat tombol hapus di samping edit");
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

// Kontrak persistensi: seluruh data bisnis wajib soft delete.
assert.match(rules, /match \/msVisits\/\{docId\}[\s\S]*allow create, update:[\s\S]*allow delete: if false/, "msVisits harus dapat diarsipkan tetapi tidak hard delete");
assert.match(rules, /match \/reviewData\/\{docId\}[\s\S]*allow create, update:[\s\S]*allow delete: if false/, "reviewData harus dapat diarsipkan tetapi tidak hard delete");
assert.doesNotMatch(html, /firebaseApi\.deleteDoc|[\s{,]deleteDoc[,\s}]/, "aplikasi tidak boleh memiliki operasi hard delete Firestore");
assert.match(html, /await Promise\.all\(\[persistMsVisitDocument\(v\), persistReviewDataDocument\(normalizedVisit\)\]\)[\s\S]*toast\("✓ Kunjungan /, "toast sukses harus sesudah persistensi");
assert.match(html, /await Promise\.all\(\[[\s\S]*archiveMsVisitDocument\(existing, deletedAt\)[\s\S]*archiveReviewDataDocument\(existingReview, deletedAt\)[\s\S]*db\.msVisits = db\.msVisits\.filter/, "hapus lokal harus sesudah arsip cloud");
assert.match(html, /const activeRows = rows=>[\s\S]*!row\.deletedAt[\s\S]*users: activeRows\(users\)[\s\S]*entries: activeRows\(kpiEntries\)[\s\S]*msVisits: activeRows\(msRows\)/, "semua koleksi yang dimuat harus menyembunyikan arsip");
assert.match(html, /Dokumen yang hilang dari snapshot lokal selalu diarsipkan[\s\S]*deletedAt:new Date\(\)\.toISOString\(\)[\s\S]*firebaseApi\.setDoc/, "sinkronisasi umum harus mengarsipkan data yang hilang");
assert.match(html, /archiveSubcollectionDocument\("kpiEntries", entry\.id\|\|entry\.k[\s\S]*Entri KPI diarsipkan/, "hapus KPI harus memakai soft delete pada dokumen aktif");
assert.match(html, /archiveSubcollectionDocument\("users"[\s\S]*Akun diarsipkan/, "hapus akun harus memakai soft delete");
assert.match(html, /fotoChanged[\s\S]*archivedFiles\.push\(\{field:"foto"[\s\S]*fotoTemuanChanged[\s\S]*archivedFiles\.push\(\{field:"fotoTemuan"/, "foto Temuan yang diganti harus tetap diarsipkan");
assert.match(html, /existing\.fotoUrl!==\(msFotoData\|\|""\)[\s\S]*archivedFiles\.push\(\{field:"fotoUrl"/, "foto Mystery Shopper yang dihapus atau diganti harus tetap diarsipkan");

// Preview skor dan filter harus mengikuti kelengkapan/hak akses.
assert.match(html, /answered<MS_ITEMS\.length/, "preview skor harus menunggu semua butir");
assert.match(html, /const scopedVisits = isOutlet\(\)[\s\S]*: isShopper\(\)/, "opsi filter harus dibatasi sesuai pengguna");
assert.match(html, /class="mini-act ms-edit-btn"/, "setiap row yang berhak harus memiliki tombol edit");
assert.match(html, /class="mini-act ms-delete-btn"[\s\S]*deleteMsVisit\(btn\.closest\("tr"\)\.dataset\.id\)/, "tombol hapus row harus memanggil penghapusan kunjungan");
assert.match(html, /function openMsForm\(id=null\)[\s\S]*editingMsVisitId = visit \? visit\.id : null/, "form harus mendukung mode edit");
assert.match(html, /visit\.skenario[\s\S]*msfSkenario[\s\S]*insertAdjacentHTML/, "skenario lama di luar opsi standar harus tetap dipertahankan");
assert.match(html, /if\(existing\) db\.msVisits\[db\.msVisits\.findIndex/, "edit harus memperbarui row, bukan menambah duplikat");
assert.match(html, /persistMsVisitDocument\(v\), persistReviewDataDocument\(normalizedVisit\)/, "edit harus menyinkronkan kunjungan dan review terkait");
assert.match(html, /id="msfFotoRemove"[\s\S]*msFotoData = ""/, "form edit harus dapat menghapus foto lama");
assert.doesNotMatch(html, /gcsDeleteByUrl|gcsDeleteQuietly/, "browser tidak boleh memiliki jalur hapus objek GCS yang tidak terotorisasi");
assert.match(html, /function validMsVideos\(videos\)[\s\S]*String\(f\.url\|\|""\)\.trim\(\)/, "video tanpa URL tidak boleh dianggap sebagai bukti");
assert.match(html, /const validVideos = validMsVideos\(v\.videos\)[\s\S]*validVideos\.length/, "badge video harus menghitung URL yang benar-benar terisi");
assert.match(html, /evidence\|\|'<span class="muted">-<\/span>'/, "kolom bukti kosong harus ditampilkan sebagai tanda strip");
assert.match(html, /waitForFirebaseAuth\(\)[\s\S]*fetchUploadWithRetry\(cfg\.signEndpoint/, "upload harus menunggu auth dan memakai retry");
assert.match(html, /PHOTO_STORAGE_DEFAULT = Object\.freeze\([\s\S]*bucket: "task-force"[\s\S]*signEndpoint:/, "semua menu foto harus memakai konfigurasi bucket operasional yang sama");
assert.match(html, /db\.meta\.fotoStorage = \{[\s\S]*enabled:true,[\s\S]*PHOTO_STORAGE_DEFAULT/, "konfigurasi tersimpan harus dikunci kembali ke GCS operasional");
assert.doesNotMatch(html, /GCS_SIGNER_DEFAULT/, "alias konfigurasi signer yang tidak diperlukan harus dibersihkan");
assert.doesNotMatch(html, /gcsUploadViaFirebaseSdk|uploadString|getDownloadURL/, "uploader Firebase lama tidak boleh tersisa");
assert.match(html, /Layanan upload foto ke bucket task-force tidak dapat dijangkau/, "kegagalan infrastruktur upload harus menjelaskan bucket tujuan");
assert.match(html, /fetchUploadWithRetry\(url, options, attempts=3\)[\s\S]*new AbortController\(\)/, "request upload harus memiliki timeout dan retry terbatas");
assert.match(html, /if\(msFotoUploading\)[\s\S]*Tunggu proses foto selesai/, "form tidak boleh disimpan saat foto masih diproses");
assert.doesNotMatch(html, /msFotoPending|fotoPending =|fotoTemuanPending =/, "state penyimpanan sementara tidak boleh tersisa pada form aktif");
assert.match(html, /img\.onerror[\s\S]*rd\.onerror/, "kegagalan membaca dan mendekode foto harus ditangani");
assert.doesNotMatch(html, /Koneksi upload terganggu — foto disimpan sementara/, "foto baru tidak boleh dianggap berhasil melalui fallback sementara");
assert.match(html, /processPhoto\(file, cb, ctx, onError\)[\s\S]*Storage tidak mengembalikan URL foto[\s\S]*if\(onError\) onError\(e\)/, "upload foto wajib menghasilkan URL Storage atau error");
assert.match(html, /fotoUploadFailed\|\|fotoTemuanUploadFailed[\s\S]*Upload foto belum berhasil/, "form temuan harus tetap terbuka setelah upload foto gagal");
assert.match(html, /if\(msFotoUploadFailed\)[\s\S]*Upload foto belum berhasil/, "form Mystery Shopper harus tetap terbuka setelah upload foto gagal");
assert.match(html, /persistItemDocument[\s\S]*closeModal\(\); renderAll\(\); toast\(successMessage\)/, "modal temuan hanya boleh ditutup dan sukses setelah persistensi");
assert.match(html, /persistMsVisitDocument\(v\)[\s\S]*msFormBack[\s\S]*toast\("✓ Kunjungan /, "modal Mystery Shopper hanya boleh ditutup dan sukses setelah persistensi");
assert.match(html, /item-conflict[\s\S]*Modal tetap terbuka; periksa lalu simpan ulang/, "konflik penyimpanan tidak boleh menutup modal sebagai sukses");
assert.match(html, /const APP_VERSION = 18;/, "versi aplikasi harus dinaikkan setelah perubahan persistensi");

// Simulasi upload dan hapus memakai fetch mock; tidak ada request atau mutasi production.
(async ()=>{
  const uploadStart = html.indexOf("function dataUrlToBlob");
  const uploadEnd = html.indexOf("/* Dipanggil form:", uploadStart);
  const uploadCalls = [];
  const uploadRuntime = {
    Blob, atob, AbortController, setTimeout, clearTimeout, console,
    firebaseAuthUser:{async getIdToken(){ return "test-token"; }},
    fotoStorageCfg:()=>({enabled:true,bucket:"task-force",signEndpoint:"https://signer.test/sign-upload"}),
    gcsReady:()=>true,
    fetch:async (url, options)=>{
      uploadCalls.push({url,options});
      if(url==="https://signer.test/sign-upload") return {
        ok:true,
        async json(){ return {
          uploadUrl:"https://storage-upload.test/signed",
          publicUrl:"https://storage.googleapis.com/task-force/uploads/2026/09/01/test.jpg",
          path:"uploads/2026/09/01/test.jpg", method:"PUT", headers:{"Content-Type":"image/png"}
        }; }
      };
      return {ok:true,status:200};
    }
  };
  vm.createContext(uploadRuntime);
  vm.runInContext(html.slice(uploadStart, uploadEnd)+"\nthis.upload=gcsUploadDataUrl;", uploadRuntime);
  const uploaded = await uploadRuntime.upload(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    {kind:"test",itemId:"local",outlet:"mock"}
  );
  assert.equal(uploaded.path, "uploads/2026/09/01/test.jpg", "simulasi upload harus mengembalikan path GCS");
  assert.equal(uploadCalls.length, 2, "upload harus terdiri dari permintaan signer dan PUT");

  let failedUploadCalls = 0;
  uploadRuntime.fetch = async ()=>{
    failedUploadCalls++;
    return {ok:false,status:400,async json(){return {error:"mock upload ditolak"};}};
  };
  await assert.rejects(
    ()=>uploadRuntime.upload("data:image/png;base64,AAAA", {kind:"test"}),
    /Layanan upload foto ke bucket task-force tidak dapat dijangkau/,
    "upload gagal harus benar-benar gagal tanpa fallback"
  );
  assert.equal(failedUploadCalls, 1, "request upload invalid tidak boleh diteruskan ke jalur lain");

  const deleteStart = html.lastIndexOf("async function deleteMsVisit");
  const deleteEnd = html.indexOf('$("#btnMsAdd")', deleteStart);
  const archived = [];
  const deleteToasts = [];
  const deleteRuntime = {
    db:{
      msVisits:[{id:"ms-local",fotoUrl:"https://storage.googleapis.com/task-force/uploads/test.jpg"}],
      reviewData:[{source_system:"mystery_gform",source_record_id:"ms-local"}]
    },
    isAdmin:()=>true, confirm:()=>true,
    archiveMsVisitDocument:async visit=>archived.push("visit:"+visit.id),
    archiveReviewDataDocument:async record=>archived.push("review:"+record.source_system+":"+record.source_record_id),
    connCfg:()=>({count:1}), save(){}, renderMystery(){},
    toast:message=>deleteToasts.push(message),
    $:()=>({classList:{remove(){}}})
  };
  vm.createContext(deleteRuntime);
  vm.runInContext(html.slice(deleteStart, deleteEnd)+"\nthis.removeVisit=deleteMsVisit;", deleteRuntime);
  await deleteRuntime.removeVisit("ms-local");
  assert.deepEqual(archived.sort(), ["review:mystery_gform:ms-local","visit:ms-local"], "hapus harus mengarsipkan kedua dokumen cloud");
  assert.equal(deleteRuntime.db.msVisits.length, 0, "row lokal harus hilang setelah arsip cloud berhasil");
  assert.match(deleteToasts.at(-1), /Kunjungan diarsipkan/, "arsip sukses harus memberi konfirmasi");

  const archiveStart = html.indexOf("async function archiveSubcollectionDocument");
  const archiveEnd = html.indexOf("function itemConflict", archiveStart);
  let archivedPayload = null;
  const archiveRuntime = {
    cloudReadOk:true, appStale:false,
    cloudShadow:{cols:{users:{"u-test":"old"}}},
    cloneData:value=>JSON.parse(JSON.stringify(value)),
    stripUndefined:value=>value,
    firebaseApi:{
      rootRef:{},
      collection:()=>({}),
      doc:(_collection,id)=>({id}),
      setDoc:async (_ref,payload)=>{ archivedPayload=payload; }
    }
  };
  vm.createContext(archiveRuntime);
  vm.runInContext(html.slice(archiveStart, archiveEnd)+"\nthis.archive=archiveSubcollectionDocument;", archiveRuntime);
  await archiveRuntime.archive("users", "u-test", {id:"u-test",name:"Akun Test"}, "2026-09-01T00:00:00.000Z");
  assert.equal(archivedPayload.deletedAt, "2026-09-01T00:00:00.000Z", "soft delete umum harus menyimpan deletedAt");
  assert.equal(archiveRuntime.cloudShadow.cols.users["u-test"], undefined, "arsip tidak boleh diproses ulang sebagai hard delete");

  console.log("Mystery Shopper regression tests: PASS");
})().catch(error=>{
  console.error(error);
  process.exitCode = 1;
});
