# GCS Upload Signer

Backend kecil untuk membuat signed URL upload foto CAPA ke Google Cloud Storage.

## Deploy Cloud Run

Jalankan dari folder repo:

```bash
gcloud config set project lms-apotekku
gcloud run deploy task-force-gcs-upload-signer \
  --source cloud-run-gcs-upload \
  --region asia-southeast2 \
  --allow-unauthenticated \
  --set-env-vars BUCKET_NAME=task-force,FIREBASE_PROJECT_ID=task-force-ose-command-center,ALLOWED_ORIGINS=https://task-force-ose-command-center.apotekku.com
```

Service account Cloud Run perlu izin berikut pada bucket `gs://task-force`:

```bash
gcloud storage buckets add-iam-policy-binding gs://task-force \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectCreator"
```

Service account yang sama juga perlu izin membuat signed URL:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Kalau foto harus bisa dibuka dari laporan/WhatsApp, berikan akses baca publik untuk folder/bucket yang dipakai atau gunakan mekanisme signed read URL.

Contoh jika seluruh object di bucket boleh dibaca publik:

```bash
gcloud storage buckets add-iam-policy-binding gs://task-force \
  --member="allUsers" \
  --role="roles/storage.objectViewer"
```

## CORS Bucket

Untuk upload signed URL dari browser, bucket perlu CORS minimal:

```json
[
  {
    "origin": ["https://task-force-ose-command-center.apotekku.com"],
    "method": ["GET", "PUT", "OPTIONS"],
    "responseHeader": ["Content-Type", "x-goog-meta-firebase-uid"],
    "maxAgeSeconds": 3600
  }
]
```

Terapkan:

```bash
gcloud storage buckets update gs://task-force --cors-file=cors.json
```

Setelah Cloud Run deploy, salin URL service ke `GCS_UPLOAD_SIGN_URL_ENDPOINT` di `index.html`, tambahkan `/sign-upload`.
