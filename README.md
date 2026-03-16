# NetSuite Integration API Scripts

Repository ini berisi kumpulan script JavaScript (SuiteScript 2.1) berjenis **RESTlet** yang digunakan untuk keperluan integrasi API mengambil data master dan transaksi dari NetSuite ke sistem eksternal. Script ini dibuat dengan fitur *pagination* (halaman) dan *filter timestamp* berdasarkan tanggal modifikasi terakhir (`lastmodified`), sehingga tarikan data bisa lebih ringan dan optimal.

## Daftar Script / Endpoint

1. **MSI-Get-Customer.js** 
   * **Fungsi**: Menarik data master Customer/Pelanggan.
   * **Field Utama**: Internal ID, Entity ID, Company Name, Email, Phone, Last Modified Date.
2. **MSI-Get-Items.js** 
   * **Fungsi**: Menarik data master Barang/Item.
3. **MSI-Get-Vendor.js** 
   * **Fungsi**: Menarik data master Vendor/Pemasok.
4. **MSI-Get-Sales-Order.js** 
   * **Fungsi**: Menarik data transaksi Sales Order (Pesanan Penjualan) beserta *line detail* item di dalamnya.
   * **Field Utama Header**: Internal ID, Tran ID, Customer ID/Name, Status, Tran Date, Last Modified Date.
   * **Field Detail (Lines)**: Item ID, Quantity, Rate, Amount, Location.
5. **MSI-Get-PurchaseOrders.js** 
   * **Fungsi**: Menarik data transaksi Purchase Order (Pesanan Pembelian) beserta *line detail* item di dalamnya.

## Format Request (Payload JSON)

Semua endpoint didesain untuk menerima HTTP method **POST** dengan format *raw body* JSON sebagai parameter *query*-nya.

```json
{
    "pageSize": 50,
    "pageIndex": 0,
    "lastmodified": "2024-01-01T00:00:00+07:00"
}
```

**Penjelasan Parameter:**
* `pageSize` *(Opsional)*: Batas jumlah data yang diambil per halaman (Default: 50). Berguna untuk menghindari *timeout* dari NetSuite.
* `pageIndex` *(Opsional)*: Menentukan urutan halaman data yang ditarik (Dimulai dari `0` untuk halaman pertama).
* `lastmodified` *(Opsional)*: Filter untuk hanya mengambil data record yang dibuat atau diubah setelah waktu tersebut. Format harus ISO 8601 (Contoh: `2024-01-01T00:00:00+07:00`). Jika tidak diisi, script akan mengambil seluruh record yang aktif.

---

## Tata Cara Setup Integrasi di NetSuite

Untuk memakai script ini, Anda perlu mendeploy RESTlet di NetSuite dan menghubungkannya dengan aman menggunakan Token-Based Authentication (TBA). Berikut langkah detailnya:

### FASE 1: Konfigurasi Keamanan (Token-Based Authentication)

#### 1. Mengaktifkan Fitur yang Dibutuhkan
1. Login ke akun NetSuite menggunakan role Administrator.
2. Navigasi ke **Setup > Company > Enable Features**.
3. Di sub-tab **SuiteCloud**, cari bagian **SuiteScript** dan pastikan kotak **RESTlets** di centang.
4. Masih di sub-tab yang sama, ke bagian **Manage Authentication**, centang **Token-Based Authentication**.
5. Klik **Save**.

#### 2. Membuat Role Khusus (Atau Edit Role Lama)
Pastikan user API punya ijin menjalankan RESTlet dan memakai Token.
1. Ke **Setup > Users/Roles > Manage Roles > New** (Atau edit role eksekutif yang ada).
2. Di bagian sub-tab **Permissions > Setup**, tambahkan *permission* berikut (*Access Level: Full*):
   * **Access Token Management**
   * **Log in using Access Tokens**
   * **RESTlets**
   * **User Access Tokens**
3. Di sub-tab **Permissions > Lists**, berikan akses (minimal *View*) ke record: **Customers, Vendors, Items**.
4. Di sub-tab **Permissions > Transactions**, berikan akses (minimal *View*) ke record: **Sales Order, Purchase Order**.
5. Klik **Save**.
6. Atur *Role* ini ke pegawai/user API yang ingin dipakai (**Setup > Users/Roles > Manage Users**).

#### 3. Membuat Integration Record (Untuk Mendapat Consumer Keys)
1. Ke **Setup > Integration > Manage Integrations > New**.
2. Beri nama integrasi (contoh: `MSI API System`).
3. State (Status): **Enabled**
4. Di sub-tab **Authentication**, **centang Token-Based Authentication**. Hilangkan centang pada opsi *TBA: Authorization Flow* atau opsi user logic jika tidak dipakai.
5. Klik **Save**.
6. **⚠️ PENTING:** NetSuite akan memunculkan informasi **Consumer Key** dan **Consumer Secret** di layar. **Copy dan simpan dengan aman karena hanya muncul 1 KALI saja.**

#### 4. Meng-generate Access Token 
1. Navigasi ke **Setup > Users/Roles > Access Tokens > New**.
2. Pilih nama aplikasi / Integrasi yang baru dibuat pada langkah 3 (Contoh: `MSI API System`).
3. Pilih **User** yang memiliki akses.
4. Pilih **Role** yang disiapkan pada langkah 2.
5. Klik **Save**.
6. **⚠️ PENTING:** NetSuite akan memunculkan **Token ID** dan **Token Secret**. **Copy dan simpan dengan aman.**

---

### FASE 2: Upload dan Deploy Script

Lakukan langkah ini untuk masing-masing ke-5 file `.js` yang di sediakan.

#### 1. Upload File Script
1. Navigasi ke **Customization > Scripting > Scripts > New**.
2. Klik ikon plus `+` pada kolom **Script File** atau cari nama file jika Anda sudah upload ke *File Cabinet* (biasanya ke folder `SuiteScripts`).
3. Upload file `MSI-Get-Customer.js` dari komputer lokal Anda.
4. Klik **Create Script Record**.

#### 2. Konfigurasi Script & Deploy
1. Beri nama record script: contoh `MSI Get Customer RESTlet`.
2. Buka tab **Deployments**.
3. Klik tipe tulisan *Custom* jika ada (atau isikan secara baris):
   * ID: `customdeploy_msi_get_customer` (terserah penamaan Anda).
   * **Status**: Ubah menjadi **Released**.
   * **Log Level**: Pilih `Debug` atau `Error`.
   * **Run As Role**: Kosongkan saja.
   * **Audience / Execute As**: Pilih Role atau biarkan sesuai default untuk User yang dituju.
4. Klik **Save**.

#### 3. Mendapatkan URL Endpoint
1. Setelah disave, klik sub-tab **Deployments**, lalu klik judul *Deployment*-nya. (Misalnya link berwarna biru/id deployment).
2. Di halaman script deployment tersebut, Anda akan menemukan field bernama **External URL** atau **URL**.
3. URL tersebut akan berbentuk seperti ini:
   `https://[id-akun-anda].suitetalk.api.netsuite.com/app/site/hosting/restlet.nl?script=xxx&deploy=xxx`.
4. URL inilah yang akan dipakai saat Anda memanggil API.

---

## 🚀 Cara Tes API Menggunakan Postman

Setelah semua setting selesai, mari kita tes endpoint-nya menggunakan *Postman*:

1. Buka Postman, dan buat request baru.
2. Ganti Method menjadi **POST**.
3. Masukkan External URL Deploymment Script Netsuite Anda.
4. Buka tab **Authorization**, lalu ubah Type menjadi **OAuth 1.0**.
5. Isi data berikut dari hasil Fase 1 di atas:
   * **Consumer Key**
   * **Consumer Secret**
   * **Access Token**
   * **Token Secret**
   * **Signature Method**: HMAC-SHA256
   * **Add authorization data to**: Request Headers
   * (Penting!) **Realm**: Masukkan **Account ID** NetSuite Anda (Terdapat pada Setup > Company > Company Information. Jika Sandbox ikuti abjad besar, misal `123456_SB1`).
6. Buka tab **Body**, dan atur opsinya ke **raw** serta format ke **JSON**.
7. Masukkan *Payload JSON* contoh:
   ```json
   {
       "pageSize": 50,
       "pageIndex": 0
   }
   ```
8. Klik **SEND**. Anda akan mendapatkan status `200 OK` dengan response berformat JSON berisikan target data NetSuite.

---
*Dokumentasi ini dibuat untuk mempermudah pengerjaan integrasi Netsuite - Script API*
