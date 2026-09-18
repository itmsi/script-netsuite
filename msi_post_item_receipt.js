/**
 * @NApiVersion 2.1
 * @NScriptType Restlet

 Create Item Receipt dari Purchase Order atau Transfer Order via transform.
 Gabungan MSI_Item_Receipt.js + msi_post_receive_item_po.js

 CATATAN Transfer Order (TO) dengan banyak Item Fulfillment (mis. useitemcostastransfercost dicentang):
 record.transform() TIDAK mendukung fromType=ITEM_FULFILLMENT -> toType=ITEM_RECEIPT (dicoba,
 hasilnya error "That type of record transformation is not allowed"). Cara yang benar: transform
 TETAP dari TRANSFER_ORDER, tapi di-scope ke 1 Item Fulfillment SPESIFIK lewat
 defaultValues.itemfulfillment (terinspirasi dari URL native UI:
 itemrcpt.nl?transform=trnfrord&itemfulfillment=<FULFILLMENT_ID>&id=<TO_ID>). Ini TERBUKTI bisa
 SELEKTIF - baris lain yang kebetulan ada di fulfillment yang sama boleh ditinggal unchecked,
 gak wajib dituntaskan semua (beda dari kalau transform TANPA scoping eksplisit, yang bikin
 NetSuite auto-advance ke fulfillment berikutnya dan MEMAKSA semua baris fulfillment saat ini
 tuntas dulu sebelum lanjut).

 Kalau caller kirim "transfer_order_id" (tanpa "fulfillment_id"), script:
   1. Cari semua Item Fulfillment milik TO itu lewat search, urut FIFO (paling lama duluan).
   2. Loop tiap fulfillment: transform di-scope ke situ, ambil qty = min(sisa yang diminta,
      yang tersedia di fulfillment itu), save kalau ada yang ke-checked.
   3. Begitu qty yang diminta terpenuhi, LANGSUNG BERHENTI - fulfillment sisanya (walau ada stok
      item yang sama di situ) SAMA SEKALI gak disentuh/gak ikut kereceive.
 Hasilnya "goods_receipts" di response bisa berisi LEBIH DARI 1 Item Receipt kalau qty yang
 diminta tersebar di beberapa Item Fulfillment (mis. diminta 10, batch pertama cuma kasih 3,
 sisanya 7 diambil dari batch berikutnya) - dan baris LAIN yang kebetulan satu fulfillment tapi
 gak diminta TETAP gak ikut ke-receive.

 Item dengan "serials" TIDAK didukung lewat "transfer_order_id" polos kalau qty-nya bisa ke-split
 ke beberapa Item Receipt (serial yang sama gak bisa dobel-assign ke tiap batch) - kirim
 "fulfillment_id" + "transfer_order_id" spesifik buat baris yang ada serial-nya.

 MODE DEBUG (investigasi, read-only, TIDAK nyimpen apapun):
 {
   "debug": true,
   "transfer_order_id": 1234,
   "fulfillment_id": 5678   // opsional: scope debug ke 1 fulfillment tertentu juga
 }
 -> transform TO ke Item Receipt (isDynamic:false, tanpa save), lalu dump semua field yang ada
 di tiap baris sublist 'item' (termasuk daftar semua field id yang tersedia).

 POST body (mode normal):
 {
   // Salah satu wajib diisi:
   "po_id": 5157,               // Internal ID Purchase Order
   "transfer_order_id": 1234,   // Internal ID Transfer Order (auto-loop per Item Fulfillment kalau perlu)
   "customer_return_id": 5678, // Internal ID Customer Return (Return Authorization)

   // Header (opsional):
   "trandate": "2026-03-11",    // format: YYYY-MM-DD, D/M/YYYY, atau D-M-YYYY (hari dulu)
   "memo": "Catatan penerimaan", // opsional
   "customform": 115, // opsional
   "class": 2, // opsional
   "location": 19, // opsional
   "department": 6, // opsional
   // custbody_* fields juga otomatis di-map

   // Lines:
   "items": [
     {
       "line_sequence": 1,      // WAJIB: linesequencenumber dari GET PO/TO response
       "item": 19611,           // opsional: validasi ganda item ID
       "quantity": 1,           // opsional: default = sisa qty (quantityremaining)
       "location": 19,          // opsional: lokasi per baris
       "department": 6,         // opsional: department per baris
       "class": 2,              // opsional: class per baris
       "rate": 150000,          // opsional: harga per unit (hanya berlaku untuk PO)
       "serials": ["SN001"],    // opsional: array serial number (gak didukung untuk auto-split TO)
       // custcol_* fields juga otomatis di-map
     }
   ]
 }

 * Kalau "items" tidak dikirim -> semua baris di-receive dengan qty sisa default.
 *
 * =============================================
 * MAPPING NOMOR BARIS (khusus TO auto-loop)
 * =============================================
 * 'line' yang dikirim caller itu nomor baris MILIK DOKUMEN CALLER, dan itu TIDAK selalu sama
 * dengan posisi baris di sublist 'item' milik TO (contoh nyata: caller ngirim line 3,5,12,15
 * padahal maksudnya baris ke-1, ke-3, ... di TO - nomornya diambil dari dokumen re-order mereka).
 * Kalau ditebak mentah sebagai posisi, baris bisa nyasar ke orderline yang salah dan yang
 * kelihatan cuma "qty kurang / belum di-Ship" padahal barangnya ADA di fulfillment itu.
 *
 * Karena itu script coba beberapa cara baca 'line' dan pakai yang orderline hasilnya BENAR-BENAR
 * ada di Item Fulfillment yang mau di-receive (dicatat di log audit 'LINE MAP'):
 *   - position   : 'line' = posisi baris di TO (perilaku lama, dipakai kalau cocok semua)
 *   - orderline  : caller sudah kirim orderline / linesequencenumber NetSuite
 *   - if_line    : 'line' = nomor baris di record Item Fulfillment (GET item fulfilments)
 *   - to_line    : 'line' = nilai field 'line' milik TO sendiri
 *   - item       : cocokkan lewat item ID (cuma kalau item itu gak dobel di TO)
 *   - position+K / orderline+K : 'line' caller ke-geser K dari salah satu di atas
 *
 * Caller juga bisa maksa (opsional):
 *   "line_mode"   : "position" | "orderline" | "if_line" | "to_line" | "item" | "auto" (default auto)
 *   "line_offset" : angka yang ditambahkan ke 'line' sebelum diterjemahkan
 *
 * PALING AMAN: kirim "line_sequence" (linesequencenumber dari GET PO/TO) atau "line_id"
 * (lineuniquekey dari GET) - itu identitas stabil, gak perlu diterjemahkan.
 */
define(['N/record', 'N/search', 'N/log', 'N/runtime', 'N/format'], function (record, search, log, runtime, format) {

    // =========================================================
    // PARSE TRANDATE
    // =========================================================
    // Support: "YYYY-MM-DD", "YYYY-MM-DDTHH:mm:ss+07:00" (ISO, komponen waktu dibuang),
    //          "D/M/YYYY", "D-M-YYYY" (konvensi MSI: hari dulu).
    // PENTING: jangan pakai new Date(string) untuk string "YYYY-MM-DD" -
    // itu diparse sebagai UTC midnight, lalu NetSuite convert ke timezone
    // akun (biasanya mundur dari UTC) sehingga tanggalnya jadi mundur 1 hari.
    // Makanya parsing manual ke komponen local date (y, m-1, d) diprioritaskan.
    // Kalau gagal parse: THROW (jangan di-skip) - kalau di-skip diam-diam, NetSuite
    // pakai default tanggal HARI INI dan receipt kelihatan sukses padahal salah.
    function parseTrandate(raw) {
        var value = String(raw).trim();
        var datePart = value.split(/[T ]/)[0]; // buang jam/timezone kalau ada
        var parts = datePart.split(/[-\/]/);
        var d = null;

        if (parts.length === 3 && !isNaN(+parts[0]) && !isNaN(+parts[1]) && !isNaN(+parts[2])) {
            d = parts[0].length === 4
                ? new Date(+parts[0], +parts[1] - 1, +parts[2])   // YYYY-MM-DD
                : new Date(+parts[2], +parts[1] - 1, +parts[0]);  // D/M/YYYY atau D-M-YYYY
        }

        if (!d || isNaN(d.getTime())) {
            // Fallback terakhir: biarkan NetSuite baca sesuai format tanggal akun
            try {
                d = format.parse({ value: datePart, type: format.Type.DATE });
            } catch (e) {
                d = null;
            }
        }

        if (!d || isNaN(d.getTime())) {
            throw new Error("Format trandate tidak valid: '" + raw + "'. Gunakan YYYY-MM-DD atau D/M/YYYY.");
        }

        log.audit('TRANDATE PARSED', 'raw: ' + raw + ' | parsed: ' + d.toISOString());
        return d;
    }

    // =========================================================
    // HELPER: Cocokkan 1 baris NetSuite ke item di payload
    // =========================================================
    // Utamakan 'line' (1-based), fallback ke line_sequence (orderline internal NetSuite),
    // fallback lagi ke line_id (composite key "sourceId_lineNumber" dari GET PO/TO response).
    function matchPayloadItem(payloadMap, lineNumOneBased, orderline, lineSeq, sourceId) {
        return payloadMap['line_' + lineNumOneBased] ||
            (orderline ? payloadMap['seq_' + String(orderline)] : null) ||
            (orderline ? payloadMap['lid_' + String(orderline)] : null) ||
            (lineSeq ? payloadMap['seq_' + String(lineSeq)] : null) ||
            (lineSeq ? payloadMap['lid_' + String(lineSeq)] : null) ||
            (lineSeq && sourceId ? payloadMap['lid_' + sourceId + '_' + lineSeq] : null) ||
            null;
    }

    // =========================================================
    // HELPER: Bangun map payload untuk pencarian O(1)
    // =========================================================
    function buildPayloadMap(payloadItems) {
        var payloadMap = {};
        if (payloadItems && payloadItems.length > 0) {
            for (var x = 0; x < payloadItems.length; x++) {
                var pItem = payloadItems[x];
                var hasLine = pItem.line !== undefined && pItem.line !== null;
                var hasSeq = pItem.line_sequence !== undefined && pItem.line_sequence !== null;

                if (!hasLine && !hasSeq && !pItem.line_id) {
                    throw new Error("Item array index " + x + ": 'line' (1-based) atau 'line_id' wajib diisi");
                }

                // 'line' adalah 1-based (1, 2, 3, ...)
                if (hasLine) payloadMap['line_' + parseInt(pItem.line, 10)] = pItem;
                // Fallback: line_sequence (orderline internal NetSuite) juga masih didukung
                if (hasSeq) payloadMap['seq_' + pItem.line_sequence] = pItem;
                // line_id: composite key "sourceId_lineNumber" dari GET PO/TO response
                if (pItem.line_id) payloadMap['lid_' + String(pItem.line_id)] = pItem;
            }
        }
        return payloadMap;
    }

    // =========================================================
    // HELPER: Set header fields Item Receipt dari payload
    // =========================================================
    function setHeaderFields(itemReceipt, params) {
        // customform di-set PALING AWAL: mengganti custom form setelah field lain
        // di-set bisa me-reset nilai default (mis. trandate balik ke tanggal hari ini).
        if (params.customform !== undefined && params.customform !== null) {
            itemReceipt.setValue({ fieldId: 'customform', value: params.customform });
        }

        ['memo', 'class', 'location', 'department'].forEach(function (field) {
            if (params[field] !== undefined && params[field] !== null) {
                itemReceipt.setValue({ fieldId: field, value: params[field] });
            }
        });

        // trandate di-set terakhir lewat parseTrandate() (lihat catatan di atas).
        if (params.trandate) {
            itemReceipt.setValue({ fieldId: 'trandate', value: parseTrandate(params.trandate) });
        }

        // Auto-map custbody_* dari payload
        for (var key in params) {
            if (key.indexOf('custbody') === 0) {
                try {
                    itemReceipt.setValue({ fieldId: key, value: params[key] });
                } catch (e) {
                    log.error('SET CUSTBODY ERROR', 'Field: ' + key + ' | ' + e.message);
                }
            }
        }
    }

    // =========================================================
    // HELPER: Isi baris item di 1 Item Receipt (Single Pass)
    // =========================================================
    // opts: { isTransferOrder, isReturnAuth, sourceId, allocate }
    // allocate = true -> dipakai waktu auto-split TO: qty dibatasi oleh sisa alokasi
    // (itemData.__remaining) DAN ketersediaan baris ini (nilai default 'quantity' dari NetSuite).
    function processReceiptLines(itemReceipt, payloadItems, payloadMap, opts) {
        // Kita JANGAN uncheck semua di awal agar NetSuite tidak lupa dengan kuantitas shipped-nya
        var lineCount = itemReceipt.getLineCount({ sublistId: 'item' });
        var itemChecked = 0;

        for (var i = 0; i < lineCount; i++) {
            itemReceipt.selectLine({ sublistId: 'item', line: i });

            var orderline = itemReceipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'orderline' });
            var lineSeq = itemReceipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'line' });

            // Jika payload kosong -> terima semua yang valid (centang manual agar qty muncul)
            if (!payloadItems || payloadItems.length === 0) {
                itemReceipt.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true });
                var autoQty = parseFloat(itemReceipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' })) || 0;

                if (autoQty > 0) {
                    itemChecked++;
                    try { itemReceipt.commitLine({ sublistId: 'item' }); } catch (e) { }
                } else {
                    itemReceipt.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: false });
                    itemReceipt.commitLine({ sublistId: 'item' });
                }
                continue;
            }

            // Cari di payloadMap: utamakan 'line' (1-based), fallback ke line_sequence (orderline NetSuite)
            var lineNum = i + 1; // Konversi loop index 0-based ke 1-based
            var itemData = matchPayloadItem(payloadMap, lineNum, orderline, lineSeq, opts.sourceId);

            if (!itemData) {
                // Tidak ada di payload -> uncheck. Berlaku sama buat PO/RA maupun TO: scoping ke
                // 1 Item Fulfillment spesifik lewat defaultValues.itemfulfillment TERBUKTI bisa
                // selektif (baris lain di fulfillment yang sama boleh ditinggal unchecked, gak
                // wajib dituntaskan semua) - lihat createFulfillmentScopedReceipt().
                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item', fieldId: 'itemreceive', value: false
                });
                itemReceipt.commitLine({ sublistId: 'item' });
                continue;
            }

            // TO multi-batch: posisi ('line') GAK stabil antar Item Fulfillment yang berbeda -
            // NetSuite bisa naruh item yang beda di posisi yang sama di batch selanjutnya. Begitu
            // 1 baris ketemu, kunci ke 'orderline' (identitas stabil di TO) dan buang key posisional
            // dari map supaya batch berikutnya cocokkan berdasarkan orderline, bukan ketiban posisi.
            if (opts.allocate && itemData.__resolvedOrderline === undefined) {
                itemData.__resolvedOrderline = orderline || lineSeq || null;
                if (itemData.__resolvedOrderline) {
                    payloadMap['seq_' + String(itemData.__resolvedOrderline)] = itemData;
                    // Key posisional cuma dibuang kalau ada pengganti stabil (seq_) buat dipakai
                    // batch selanjutnya - biar gak "kehilangan" baris ini kalau orderline kosong.
                    if (itemData.line !== undefined && itemData.line !== null) {
                        delete payloadMap['line_' + parseInt(itemData.line, 10)];
                    }
                }
            }

            // Set itemreceive = true
            itemReceipt.setCurrentSublistValue({
                sublistId: 'item', fieldId: 'itemreceive', value: true
            });

            var serials = itemData.serials || [];
            var qty;

            if (opts.allocate) {
                // Auto-split TO: qty = min(sisa yang masih diminta, yang tersedia di fulfillment ini)
                var available = parseFloat(itemReceipt.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' })) || 0;
                var remaining = itemData.__remaining === undefined ? Infinity : itemData.__remaining;
                qty = Math.min(available, remaining);

                if (!(qty > 0)) {
                    // Sisa alokasi udah 0 (sudah kepenuhi fulfillment sebelumnya), atau fulfillment ini
                    // gak punya sisa buat baris ini -> uncheck
                    itemReceipt.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: false });
                    itemReceipt.commitLine({ sublistId: 'item' });
                    continue;
                }

                itemData.__remaining = (remaining === Infinity) ? Infinity : (remaining - qty);
            } else if (serials.length > 0) {
                qty = serials.length;
            } else if (itemData.quantity !== undefined && itemData.quantity !== null) {
                qty = parseFloat(itemData.quantity) || 0;
            }
            // Jika tidak ada qty di payload -> biarkan NetSuite yang menentukan (default shipped)

            if (qty !== undefined && qty > 0) {
                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item', fieldId: 'quantity', value: qty
                });
                log.debug('SET QTY', 'Line index: ' + i + ' | orderline: ' + orderline + ' | qty: ' + qty);
            } else if (qty !== undefined && qty <= 0) {
                // qty dikirim tapi 0 atau negatif -> skip
                itemReceipt.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: false });
                itemReceipt.commitLine({ sublistId: 'item' });
                continue;
            }
            // else qty === undefined -> tidak diset, NetSuite pakai default

            // Line fields
            ['location', 'department', 'class'].forEach(function (f) {
                if (itemData[f] !== undefined && itemData[f] !== null) {
                    itemReceipt.setCurrentSublistValue({
                        sublistId: 'item', fieldId: f, value: itemData[f]
                    });
                }
            });

            if (!opts.isTransferOrder && !opts.isReturnAuth && itemData.rate !== undefined && itemData.rate !== null) {
                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item', fieldId: 'unitcost', value: itemData.rate
                });
            }

            // Auto-map custcol_*
            for (var lineKey in itemData) {
                if (lineKey.indexOf('custcol') === 0) {
                    try {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item', fieldId: lineKey, value: itemData[lineKey]
                        });
                    } catch (e) {
                        log.error('SET CUSTCOL ERROR', lineKey + ': ' + e.message);
                    }
                }
            }

            // Inventory Detail / Serials
            if (serials.length > 0) {
                try {
                    var inventoryDetail = itemReceipt.getCurrentSublistSubrecord({
                        sublistId: 'item', fieldId: 'inventorydetail'
                    });

                    var existingLines = inventoryDetail.getLineCount({ sublistId: 'inventoryassignment' });
                    for (var r = existingLines - 1; r >= 0; r--) {
                        inventoryDetail.removeLine({ sublistId: 'inventoryassignment', line: r });
                    }

                    for (var s = 0; s < serials.length; s++) {
                        inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });
                        try {
                            inventoryDetail.setCurrentSublistText({
                                sublistId: 'inventoryassignment', fieldId: 'receiptinventorynumber', text: String(serials[s])
                            });
                        } catch (e) {
                            inventoryDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment', fieldId: 'receiptinventorynumber', value: serials[s]
                            });
                        }
                        inventoryDetail.setCurrentSublistValue({
                            sublistId: 'inventoryassignment', fieldId: 'quantity', value: 1
                        });
                        inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
                    }
                } catch (invErr) {
                    throw new Error('Gagal set serial di line: ' + invErr.message);
                }
            }

            try {
                itemReceipt.commitLine({ sublistId: 'item' });
            } catch (commitErr) {
                if (commitErr.message && commitErr.message.indexOf('You can not receive more') > -1) {
                    throw new Error("Gagal commit baris: Kuantitas melebihi jumlah yang sudah di-Shipped.");
                }
                throw commitErr;
            }

            itemChecked++;
        }

        return itemChecked;
    }

    // =========================================================
    // HELPER: Save Item Receipt + create note + bangun 1 baris response
    // =========================================================
    function saveItemReceiptAndBuildResponse(itemReceipt, params, sourceId, sourceRecordType, sourceKey, sourceNumKey, sourceTypeName) {
        var irId;
        try {
            // enableSourcing dimatikan untuk SEMUA tipe (PO, TO, Return Auth).
            // Untuk TO, transform sudah membawa location (lokasi tujuan),
            // quantity, dan cost dari Item Fulfillment yang sedang di-scope — jadi sourcing tidak wajib.
            // Dengan sourcing off, nilai class/location/department dari payload
            // (atau hasil transform dari source) menempel apa adanya,
            // tidak ditimpa sourcing rules (default item record / vendor).
            var saveOpts = { enableSourcing: false, ignoreMandatoryFields: true };
            irId = itemReceipt.save(saveOpts);
        } catch (saveErr) {
            if (saveErr.message && saveErr.message.indexOf('You can not receive more') > -1) {
                throw new Error("Gagal Save: Tidak bisa menerima barang dari Transfer Order. Kemungkinan penyebab: (1) Item Fulfillment terkait belum di-Approve (cek Approval Status di IF), (2) Kuantitas melebihi jumlah yang di-Shipped, atau (3) Barang sudah pernah di-receive sebelumnya. Detail: " + saveErr.message);
            }
            throw saveErr;
        }

        // 28 Juli 2026 Dharma Create Add note after save success
        // ==============================
        // CREATE NOTE (FIRST)
        // ==============================
        if (params.note && params.note.trim() !== "") {

            var noteRec = record.create({
                type: 'note',
                isDynamic: true
            });

            noteRec.setValue({
                fieldId: 'title',
                value: params.noteTitle || 'API Note'
            });

            noteRec.setValue({
                fieldId: 'note',
                value: params.note
            });

            noteRec.setValue({
                fieldId: 'transaction',
                value: irId
            });

            noteRec.setValue({
                fieldId: 'author',
                value: runtime.getCurrentUser().id
            });

            noteRec.save();
        }

        // Build 1 baris response
        try {
            var irFields = search.lookupFields({
                type: search.Type.ITEM_RECEIPT,
                id: irId,
                columns: ['tranid', 'trandate']
            });

            var sourceFields = search.lookupFields({
                type: sourceRecordType,
                id: sourceId,
                columns: ['tranid']
            });

            var sourceTranId = Array.isArray(sourceFields.tranid)
                ? (sourceFields.tranid.length > 0 ? sourceFields.tranid[0].text : '')
                : (sourceFields.tranid || '');

            var lineObj = {
                id: irId,
                tranid: irFields.tranid || '',
                trandate: irFields.trandate || '',
                source_type: sourceTypeName
            };
            lineObj[sourceKey] = sourceId;
            lineObj[sourceNumKey] = sourceTranId;

            return lineObj;

        } catch (e) {
            log.error('ERROR fetch IR info', e.message);
            // Tetap kembalikan irId meskipun lookupFields gagal
            var fallbackObj = { id: irId };
            fallbackObj[sourceKey] = sourceId;
            return fallbackObj;
        }
    }

    // =========================================================
    // HELPER: Buat 1 Item Receipt dari 1 sumber (PO / Return Auth)
    // =========================================================
    function createOneReceipt(sourceType, sourceId, params, flags) {
        var itemReceipt = record.transform({
            fromType: sourceType,
            fromId: sourceId,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: true  // wajib true untuk akses inventorydetail subrecord (serial)
        });

        setHeaderFields(itemReceipt, params);

        var payloadItems = params.items || params.lines; // Support format lama "lines"
        var payloadMap = buildPayloadMap(payloadItems);

        var itemChecked = processReceiptLines(itemReceipt, payloadItems, payloadMap, {
            isTransferOrder: flags.isTransferOrder,
            isReturnAuth: flags.isReturnAuth,
            sourceId: sourceId,
            allocate: false
        });

        if (itemChecked === 0) {
            throw new Error("Tidak ada item valid untuk di-receive. Pastikan sudah 'Shipped'.");
        }

        return saveItemReceiptAndBuildResponse(
            itemReceipt, params, sourceId, flags.sourceRecordType,
            flags.sourceKey, flags.sourceNumKey, flags.sourceTypeName
        );
    }

    // =========================================================
    // HELPER: Buat 1 Item Receipt yang di-scope ke 1 Item Fulfillment SPESIFIK
    // =========================================================
    // fromType TETAP TRANSFER_ORDER (fromType=ITEM_FULFILLMENT ditolak NetSuite) - scoping ke
    // fulfillment tertentu dilakukan lewat defaultValues.itemfulfillment, terinspirasi dari URL
    // native UI: itemrcpt.nl?transform=trnfrord&itemfulfillment=<ID>&id=<TO_ID>.
    //
    // allocate:false (SELEKTIF) - baris yang gak ada di payload di-uncheck, BUKAN dipaksa full.
    // Ini buat nguji apakah NetSuite ngizinin nerima SEBAGIAN baris dari 1 fulfillment kalau kita
    // eksplisit sebut fulfillment-nya (beda dari loop auto-advance yang TERBUKTI maksa semua baris
    // tuntas). Kalau NetSuite tetap nolak partial di sini juga, berarti itu batasan mutlak platform
    // - gak ada cara lain lewat script buat nerima sebagian doang dari barang yang sepaket.
    function createScopedFulfillmentReceipt(transferOrderId, fulfillmentId, params) {
        var itemReceipt = record.transform({
            fromType: record.Type.TRANSFER_ORDER,
            fromId: transferOrderId,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: true,
            defaultValues: { itemfulfillment: fulfillmentId }
        });

        setHeaderFields(itemReceipt, params);

        var payloadItems = params.items || params.lines;
        var payloadMap = buildPayloadMap(payloadItems);

        var itemChecked = processReceiptLines(itemReceipt, payloadItems, payloadMap, {
            isTransferOrder: true,
            isReturnAuth: false,
            sourceId: fulfillmentId,
            allocate: false
        });

        if (itemChecked === 0) {
            throw new Error("Tidak ada item valid untuk di-receive dari Item Fulfillment " + fulfillmentId + ".");
        }

        return saveItemReceiptAndBuildResponse(
            itemReceipt, params, fulfillmentId, search.Type.ITEM_FULFILLMENT,
            'fulfillment_id', 'fulfillment_number', 'item_fulfillment'
        );
    }

    // =========================================================
    // HELPER: Cek apakah semua baris payload (yang punya qty eksplisit) sudah terpenuhi
    // =========================================================
    function allRequestsSatisfied(payloadItems) {
        for (var i = 0; i < payloadItems.length; i++) {
            var remaining = payloadItems[i].__remaining;
            if (remaining === Infinity) return false; // masih mau ambil semua yang ada
            if (remaining > 0) return false;
        }
        return true;
    }

    // =========================================================
    // HELPER: Isi baris item (STANDARD MODE, bukan dynamic) - khusus loop auto-split TO
    // =========================================================
    // Semua debug call yang berhasil (selalu isDynamic:false) SELALU nunjukin data yang benar,
    // sedangkan proses receive asli (isDynamic:true, pakai selectLine/commitLine) TERBUKTI stale di
    // transform ke-3/ke-4 dst dalam 1 eksekusi yang sama (record.load() workaround gak ngefek).
    // Jadi loop auto-split TO dipindah ke standard mode (getSublistValue/setSublistValue by index,
    // gak butuh selectLine/commitLine) - gak masalah karena serial number (butuh dynamic mode buat
    // akses inventorydetail subrecord) memang udah gak didukung di jalur auto-split ini.
    function processReceiptLinesStandard(itemReceipt, payloadItems, payloadMap, opts) {
        var lineCount = itemReceipt.getLineCount({ sublistId: 'item' });
        var itemChecked = 0;

        for (var i = 0; i < lineCount; i++) {
            var orderline = itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'orderline', line: i });
            var lineSeq = itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i });

            if (!payloadItems || payloadItems.length === 0) {
                var autoQty = parseFloat(itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
                if (autoQty > 0) {
                    itemReceipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: true });
                    itemChecked++;
                } else {
                    itemReceipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: false });
                }
                continue;
            }

            var lineNum = i + 1;
            var itemData = matchPayloadItem(payloadMap, lineNum, orderline, lineSeq, opts.sourceId);

            if (!itemData) {
                itemReceipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: false });
                continue;
            }

            // Pin ke orderline (sama seperti versi dynamic) - posisi gak stabil antar fulfillment
            if (itemData.__resolvedOrderline === undefined) {
                itemData.__resolvedOrderline = orderline || lineSeq || null;
                if (itemData.__resolvedOrderline) {
                    payloadMap['seq_' + String(itemData.__resolvedOrderline)] = itemData;
                    if (itemData.line !== undefined && itemData.line !== null) {
                        delete payloadMap['line_' + parseInt(itemData.line, 10)];
                    }
                }
            }

            var available = parseFloat(itemReceipt.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
            var remaining = itemData.__remaining === undefined ? Infinity : itemData.__remaining;
            var qty = Math.min(available, remaining);

            if (!(qty > 0)) {
                itemReceipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: false });
                continue;
            }

            itemData.__remaining = (remaining === Infinity) ? Infinity : (remaining - qty);

            itemReceipt.setSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i, value: true });
            itemReceipt.setSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i, value: qty });

            ['location', 'department', 'class'].forEach(function (f) {
                if (itemData[f] !== undefined && itemData[f] !== null) {
                    itemReceipt.setSublistValue({ sublistId: 'item', fieldId: f, line: i, value: itemData[f] });
                }
            });

            for (var lineKey in itemData) {
                if (lineKey.indexOf('custcol') === 0) {
                    try {
                        itemReceipt.setSublistValue({ sublistId: 'item', fieldId: lineKey, line: i, value: itemData[lineKey] });
                    } catch (e) {
                        log.error('SET CUSTCOL ERROR', lineKey + ': ' + e.message);
                    }
                }
            }

            log.debug('SET QTY', 'Line index: ' + i + ' | orderline: ' + orderline + ' | qty: ' + qty);
            itemChecked++;
        }

        return itemChecked;
    }

    // =========================================================
    // HELPER: Cari semua Item Fulfillment milik 1 Transfer Order, urut FIFO (paling lama duluan)
    // =========================================================
    function findEligibleFulfillments(transferOrderId) {
        var results = [];
        var s = search.create({
            type: search.Type.ITEM_FULFILLMENT,
            filters: [
                ['createdfrom', 'anyof', [transferOrderId]],
                'AND', ['mainline', 'is', 'T']
            ],
            columns: [
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'trandate', sort: search.Sort.ASC }),
                search.createColumn({ name: 'internalid', sort: search.Sort.ASC })
            ]
        });

        s.run().each(function (r) {
            results.push({ id: r.id, tranid: r.getText({ name: 'tranid' }) || r.getValue({ name: 'tranid' }) });
            return true;
        });

        return results;
    }

    // =========================================================
    // HELPER: Peta posisi (1-based) -> orderline ASLI
    // =========================================================
    // Field 'line' di record TO sendiri TERBUKTI beda "ruang nomor" dari 'orderline' di dokumen
    // turunan (TO pakai 1,4,7 - kemungkinan ada baris lain yang ikut ke-hitung di situ - sementara
    // downstream pakai 3,6,9). Jadi gak bisa baca 'line' dari TO langsung. Solusinya 2 langkah:
    //   1. Posisi NATURAL item di TO (urutan baris di sublist 'item', BUKAN nilai field 'line') -
    //      ini stabil karena TO pasti punya SEMUA baris lengkap.
    //   2. orderline per ITEM (bukan per posisi) digabung dari SEMUA Item Fulfillment TO ini,
    //      dicocokkan berdasarkan identitas item - aman walau ada fulfillment yang gak lengkap,
    //      karena yang jadi kunci pencocokan itu ITEM-nya, bukan posisinya.
    //
    // KALAU item YANG SAMA muncul di lebih dari 1 baris TO (mis. item X di line 4 DAN line 5):
    // gak bisa dicocokkan lewat identitas item doang (dua-duanya sama). Solusinya: hitung SELISIH
    // TETAP antara 'orderline' dan field 'line' milik TO sendiri, pakai item-item yang GAK dobel
    // sebagai kalibrasi (itu pasti benar, gak ambigu - kebukti dari semua TO yang udah dites,
    // selisihnya selalu KONSISTEN, mis. +2). Begitu selisihnya ketemu dan konsisten, langsung
    // hitung orderline = TO_line + selisih buat SEMUA posisi termasuk yang dobel - gak perlu nebak
    // dari fulfillment mana yang kebetulan udah ke-shipped/ke-scan duluan.
    function getTransferOrderLineMap(transferOrderId, fulfillments) {
        var toRecord = record.load({ type: record.Type.TRANSFER_ORDER, id: transferOrderId, isDynamic: false });
        var positionToItem = {};
        var positionToOwnLine = {};
        var positionToFilteredPos = {};   // posisi natural -> posisi setelah baris full-received di-skip & dinomorin ulang
        var positionToShippablePos = {};  // posisi natural -> posisi setelah baris "belum pernah di-ship" di-skip & dinomorin ulang
        var itemPositionCount = {};
        var toLineCount = toRecord.getLineCount({ sublistId: 'item' });
        var filteredCounter = 0;
        var shippableCounter = 0;
        for (var i = 0; i < toLineCount; i++) {
            var itmId = toRecord.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });
            var pos = i + 1;
            positionToItem[pos] = itmId;
            positionToOwnLine[pos] = toRecord.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i });
            itemPositionCount[itmId] = (itemPositionCount[itmId] || 0) + 1;

            var toQty = parseFloat(toRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
            var toQtyFulfilled = parseFloat(toRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line: i })) || 0;
            var toQtyReceived = parseFloat(toRecord.getSublistValue({ sublistId: 'item', fieldId: 'quantityreceived', line: i })) || 0;

            // "Belum full-received" (dibandingin ke total qty ORDER) - salah satu variasi filter
            // yang mungkin dipakai sistem eksternal buat nomorin ulang baris dari 1.
            if (toQtyReceived < toQty) {
                filteredCounter++;
                positionToFilteredPos[pos] = filteredCounter;
            }

            // "Udah di-fulfill (shipped) tapi belum di-receive" - variasi filter LAIN yang TERBUKTI
            // dipakai di kasus nyata: baris yang Fulfilled=0 (belum pernah dikirim sama sekali)
            // di-skip total dari nomor eksternal, cuma baris yang ADA sisa siap-diterima yang muncul.
            if (toQtyFulfilled > toQtyReceived) {
                shippableCounter++;
                positionToShippablePos[pos] = shippableCounter;
            }
        }

        // orderline per ITEM: disimpan sebagai LIST (bukan cuma yang pertama) supaya item yang
        // muncul di beberapa baris TO (dobel) tetap bisa dipetakan berurutan, bukan semuanya
        // ditimpuk ke orderline yang sama.
        //
        // PENTING: baca 'orderline' di sini lewat record.transform(TO->ITEM_RECEIPT, defaultValues) -
        // TERBUKTI metode ini kasih nilai BEDA (konsisten +1 di satu kasus nyata) dibanding baca
        // langsung dari record.load(ITEM_FULFILLMENT) yang dipakai getFulfillmentOrderlineIndex().
        // Proses receive ASLI (processReceiptLinesStandard) baca 'orderline' lewat metode transform
        // ini juga - jadi validOrderlines HARUS dari sumber yang SAMA, bukan dari ifIndex, biar
        // scoring gak nyalah-nyalahin kandidat yang justru benar buat eksekusi aslinya.
        var itemToOrderlines = {};
        var validOrderlines = {};
        for (var f = 0; f < fulfillments.length; f++) {
            var preview = record.transform({
                fromType: record.Type.TRANSFER_ORDER,
                fromId: transferOrderId,
                toType: record.Type.ITEM_RECEIPT,
                isDynamic: false,
                defaultValues: { itemfulfillment: fulfillments[f].id }
            });
            var previewLineCount = preview.getLineCount({ sublistId: 'item' });
            for (var p = 0; p < previewLineCount; p++) {
                var itemId = preview.getSublistValue({ sublistId: 'item', fieldId: 'item', line: p });
                var orderline = preview.getSublistValue({ sublistId: 'item', fieldId: 'orderline', line: p });
                if (!itemId || orderline === '' || orderline === null || orderline === undefined) continue;
                validOrderlines[String(orderline)] = true;
                if (!itemToOrderlines[itemId]) itemToOrderlines[itemId] = [];
                if (itemToOrderlines[itemId].indexOf(String(orderline)) === -1) {
                    itemToOrderlines[itemId].push(String(orderline));
                }
            }
        }

        function firstOrderlineOf(itemId) {
            var list = itemToOrderlines[itemId];
            return (list && list.length > 0) ? list[0] : undefined;
        }

        // Kalibrasi selisih dari posisi yang GAK dobel (unambiguous) dan udah ketemu orderline-nya
        var offsetVotes = {};
        for (var calibPos in positionToItem) {
            if (itemPositionCount[positionToItem[calibPos]] > 1) continue; // skip item dobel
            var calibOrderline = firstOrderlineOf(positionToItem[calibPos]);
            if (calibOrderline === undefined) continue; // belum ketemu di fulfillment manapun, skip
            var offset = parseInt(calibOrderline, 10) - parseInt(positionToOwnLine[calibPos], 10);
            offsetVotes[offset] = (offsetVotes[offset] || 0) + 1;
        }
        var offsetKeys = Object.keys(offsetVotes);
        var consistentOffset = (offsetKeys.length === 1) ? parseInt(offsetKeys[0], 10) : null;

        var map = {};
        var positions = [];
        var occurrenceUsed = {}; // itemId -> berapa kali item itu sudah dipetakan (buat item dobel)
        for (var pos2 in positionToItem) {
            var posItemId = positionToItem[pos2];

            if (consistentOffset !== null) {
                // Selisih konsisten -> hitung langsung, gak perlu peduli item dobel atau nggak
                map[pos2] = String(parseInt(positionToOwnLine[pos2], 10) + consistentOffset);
            } else {
                // Gak bisa kalibrasi (mis. yang cuma ke-ship baris item yang memang dobel) -> fallback
                // pencocokan by-item. Kalau itemnya dobel, pakai orderline ke-N yang ditemukan
                // (occurrence order) - lebih tepat daripada semua posisi ditimpuk ke orderline pertama.
                var olList = itemToOrderlines[posItemId] || [];
                var usedCount = occurrenceUsed[posItemId] || 0;
                map[pos2] = (usedCount < olList.length) ? olList[usedCount] : olList[olList.length - 1];
                occurrenceUsed[posItemId] = usedCount + 1;
            }

            positions.push({
                pos: parseInt(pos2, 10),
                item: posItemId,
                ownLine: positionToOwnLine[pos2],
                filteredPos: positionToFilteredPos[pos2] || null,
                shippablePos: positionToShippablePos[pos2] || null,
                orderline: (map[pos2] === undefined || map[pos2] === null) ? null : String(map[pos2])
            });
        }
        positions.sort(function (a, b) { return a.pos - b.pos; });

        // filteredMap/shippableMap: posisi HASIL FILTER (masing-masing kriteria) -> orderline.
        // Ini buat nyocokkan sistem eksternal yang nomorin baris dengan cara nge-skip baris tertentu.
        var filteredMap = {};
        var shippableMap = {};
        for (var fp = 0; fp < positions.length; fp++) {
            if (positions[fp].orderline === null) continue;
            if (positions[fp].filteredPos !== null) filteredMap[positions[fp].filteredPos] = positions[fp].orderline;
            if (positions[fp].shippablePos !== null) shippableMap[positions[fp].shippablePos] = positions[fp].orderline;
        }

        return {
            map: map,                     // posisi natural TO (1-based) -> orderline
            filteredMap: filteredMap,     // posisi setelah skip baris full-received -> orderline
            shippableMap: shippableMap,   // posisi setelah skip baris yang belum pernah di-ship -> orderline
            positions: positions,         // detail per baris TO (pos, item, 'line' TO, orderline)
            offset: consistentOffset,     // selisih terkalibrasi, null kalau gak konsisten
            validOrderlines: validOrderlines // set orderline yang kebaca via metode transform (sama kayak eksekusi asli)
        };
    }

    // =========================================================
    // HELPER: Terjemahkan nomor baris dari CALLER -> orderline (nomor baris TO)
    // =========================================================
    // MASALAHNYA: 'line' yang dikirim caller itu nomor baris MILIK DOKUMEN CALLER, dan itu GAK
    // selalu sama dengan posisi baris di sublist 'item' milik TO. Contoh nyata: caller ngirim
    // line 3, 5, 12, 15 - padahal maksudnya baris ke-1, ke-3, ... di TO ("line 3 dianggap line 1"),
    // karena nomor itu diambil dari dokumen re-order mereka. Kalau ditebak mentah sebagai posisi,
    // 'line' bisa nyasar ke orderline yang salah - atau ke orderline milik ITEM YANG SAMA di baris
    // lain - lalu baris yang harusnya ke-receive di-skip diam-diam dan response-nya cuma bilang
    // "qty kurang / belum di-Ship" padahal barangnya ADA di fulfillment itu.
    //
    // SOLUSINYA: jangan tebak satu cara. Coba beberapa cara baca, lalu pakai yang hasilnya paling
    // masuk akal - yaitu yang orderline hasil terjemahannya BENAR-BENAR ada di Item Fulfillment
    // yang mau di-receive. Mode 'position' (perilaku lama) tetap menang kalau dia sudah cocok
    // semua, jadi TO yang sekarang jalan gak berubah perilakunya.
    //
    // Caller juga bisa maksa mode lewat payload:
    //   "line_mode": "position" | "orderline" | "if_line" | "to_line" | "item"
    //   "line_offset": angka yang ditambahkan ke 'line' sebelum diterjemahkan
    // Kalau dua-duanya kosong -> "auto" (deteksi otomatis).

    // Baca nomor baris Item Fulfillment -> orderline. Caller yang ambil data dari GET item
    // fulfilments ngirim 'line' versi IF ini (linesequencenumber), bukan posisi baris di TO.
    function getFulfillmentOrderlineIndex(fulfillments) {
        var idx = { ifLineToOrderline: {}, orderlines: {}, itemToOrderlines: {} };

        function readLine(ifRec, fieldId, i) {
            try {
                return ifRec.getSublistValue({ sublistId: 'item', fieldId: fieldId, line: i });
            } catch (e) {
                return null; // field gak tersedia di sublist ini
            }
        }

        for (var f = 0; f < fulfillments.length; f++) {
            try {
                var ifRec = record.load({ type: record.Type.ITEM_FULFILLMENT, id: fulfillments[f].id, isDynamic: false });
                var lineCount = ifRec.getLineCount({ sublistId: 'item' });

                for (var i = 0; i < lineCount; i++) {
                    var orderline = readLine(ifRec, 'orderline', i);
                    if (orderline === '' || orderline === null || orderline === undefined) continue;

                    var olKey = String(orderline);
                    var itemKey = String(readLine(ifRec, 'item', i));
                    idx.orderlines[olKey] = true;

                    if (!idx.itemToOrderlines[itemKey]) idx.itemToOrderlines[itemKey] = [];
                    if (idx.itemToOrderlines[itemKey].indexOf(olKey) === -1) {
                        idx.itemToOrderlines[itemKey].push(olKey);
                    }

                    var ifLine = readLine(ifRec, 'line', i);
                    if (ifLine !== '' && ifLine !== null && ifLine !== undefined && idx.ifLineToOrderline[String(ifLine)] === undefined) {
                        idx.ifLineToOrderline[String(ifLine)] = olKey;
                    }
                }
            } catch (e) {
                log.error('LOAD IF ERROR', 'Fulfillment ' + fulfillments[f].id + ': ' + e.message);
            }
        }

        return idx;
    }

    function resolveTransferOrderPayloadLines(transferOrderId, fulfillments, payloadItems, params) {
        var needLine = [];
        for (var i = 0; i < payloadItems.length; i++) {
            var it = payloadItems[i];
            var hasSeq = it.line_sequence !== undefined && it.line_sequence !== null;
            if (hasSeq || it.line_id) continue;                          // key sudah stabil, biarkan
            if (it.__lineRaw === undefined || it.__lineRaw === null) continue;
            it.__payloadIndex = i;
            needLine.push(it);
        }
        if (needLine.length === 0) return;

        var toLineInfo = getTransferOrderLineMap(transferOrderId, fulfillments);
        var posMap = toLineInfo.map || {};
        var filteredPosMap = toLineInfo.filteredMap || {};
        var shippablePosMap = toLineInfo.shippableMap || {};
        var positions = toLineInfo.positions || [];
        var validOrderlines = toLineInfo.validOrderlines || {};
        var ifIndex = getFulfillmentOrderlineIndex(fulfillments);

        // 'line' milik TO sendiri -> orderline (buat mode 'to_line')
        var ownLineToOrderline = {};
        for (var p = 0; p < positions.length; p++) {
            if (positions[p].ownLine === null || positions[p].ownLine === undefined) continue;
            if (positions[p].orderline === null) continue;
            ownLineToOrderline[String(positions[p].ownLine)] = positions[p].orderline;
        }

        function makePositionResolver(offset) {
            return function (rawLine) {
                var n = parseInt(rawLine, 10);
                if (isNaN(n)) return null;
                var ol = posMap[n + offset];
                return (ol === undefined || ol === null) ? null : String(ol);
            };
        }

        // Sistem eksternal ada yang cuma nampilin baris yang BELUM full-received, dinomorin ulang
        // dari 1 (baris yang qty-nya udah full ke-receive di-skip, gak dihitung). Beda dari posisi
        // natural TO (yang ngitung SEMUA baris termasuk yang udah full-received).
        function makeFilteredPositionResolver(offset) {
            return function (rawLine) {
                var n = parseInt(rawLine, 10);
                if (isNaN(n)) return null;
                var ol = filteredPosMap[n + offset];
                return (ol === undefined || ol === null) ? null : String(ol);
            };
        }

        // Variasi lain: sistem eksternal ada yang cuma nampilin baris yang UDAH pernah di-Fulfill
        // (shipped) - baris yang Fulfilled=0 (belum pernah dikirim sama sekali) di-skip total dari
        // nomor eksternal, dinomorin ulang dari 1 buat sisanya.
        function makeShippablePositionResolver(offset) {
            return function (rawLine) {
                var n = parseInt(rawLine, 10);
                if (isNaN(n)) return null;
                var ol = shippablePosMap[n + offset];
                return (ol === undefined || ol === null) ? null : String(ol);
            };
        }

        function makeOrderlineResolver(offset) {
            return function (rawLine) {
                var n = parseInt(rawLine, 10);
                return isNaN(n) ? null : String(n + offset);
            };
        }

        function makeTableResolver(table) {
            return function (rawLine) {
                var ol = table[String(rawLine)];
                return (ol === undefined || ol === null) ? null : String(ol);
            };
        }

        // Cocokkan lewat identitas item (cuma kalau itemnya GAK dobel - kalau dobel, ambigu)
        function makeItemResolver() {
            return function (rawLine, payloadItem) {
                if (!payloadItem || payloadItem.item === undefined || payloadItem.item === null) return null;
                var list = ifIndex.itemToOrderlines[String(payloadItem.item)];
                return (list && list.length === 1) ? list[0] : null;
            };
        }

        // ---- Susun daftar kandidat mode ----
        // Default 'shippable_position' (BUKAN auto-deteksi) - TERBUKTI auto-deteksi bisa milih mode
        // yang salah kalau lebih dari 1 mode sama-sama "valid" secara teknis (skornya nyambung ke
        // orderline yang beneran ada) tapi beda target. Caller masih bisa override eksplisit lewat
        // "line_mode" (termasuk "auto" buat balik ke auto-deteksi kalau memang dibutuhkan).
        var forcedMode = params.line_mode ? String(params.line_mode) : 'shippable_position';
        var forcedOffset = (params.line_offset === undefined || params.line_offset === null || params.line_offset === '') ? 0 : parseInt(params.line_offset, 10);
        if (isNaN(forcedOffset)) forcedOffset = 0;

        var candidates = [];

        if (forcedMode) {
            var forced = null;
            if (forcedMode === 'position') forced = makePositionResolver(forcedOffset);
            else if (forcedMode === 'filtered_position') forced = makeFilteredPositionResolver(forcedOffset);
            else if (forcedMode === 'shippable_position') forced = makeShippablePositionResolver(forcedOffset);
            else if (forcedMode === 'orderline') forced = makeOrderlineResolver(forcedOffset);
            else if (forcedMode === 'if_line') forced = makeTableResolver(ifIndex.ifLineToOrderline);
            else if (forcedMode === 'to_line') forced = makeTableResolver(ownLineToOrderline);
            else if (forcedMode === 'item') forced = makeItemResolver();
            else if (forcedMode !== 'auto') {
                throw new Error("'line_mode' tidak dikenal: '" + forcedMode + "'. Pakai 'position', 'filtered_position', 'shippable_position', 'orderline', 'if_line', 'to_line', 'item', atau 'auto'.");
            }

            if (forced) {
                candidates.push({ name: forcedMode + (forcedOffset ? ' (offset ' + forcedOffset + ')' : ''), resolve: forced });
            }
        }

        if (candidates.length === 0) {
            // 'position' HARUS paling depan - kalau dia udah cocok semua, dia yang dipakai (backward compatible)
            candidates.push({ name: 'position', resolve: makePositionResolver(0) });
            candidates.push({ name: 'filtered_position', resolve: makeFilteredPositionResolver(0) });
            candidates.push({ name: 'shippable_position', resolve: makeShippablePositionResolver(0) });
            candidates.push({ name: 'orderline', resolve: makeOrderlineResolver(0) });
            candidates.push({ name: 'if_line', resolve: makeTableResolver(ifIndex.ifLineToOrderline) });
            candidates.push({ name: 'to_line', resolve: makeTableResolver(ownLineToOrderline) });
            candidates.push({ name: 'item', resolve: makeItemResolver() });

            for (var k = 1; k <= 8; k++) {
                candidates.push({ name: 'position+' + k, resolve: makePositionResolver(k) });
                candidates.push({ name: 'position-' + k, resolve: makePositionResolver(-k) });
                candidates.push({ name: 'filtered_position+' + k, resolve: makeFilteredPositionResolver(k) });
                candidates.push({ name: 'filtered_position-' + k, resolve: makeFilteredPositionResolver(-k) });
                candidates.push({ name: 'shippable_position+' + k, resolve: makeShippablePositionResolver(k) });
                candidates.push({ name: 'shippable_position-' + k, resolve: makeShippablePositionResolver(-k) });
                candidates.push({ name: 'orderline+' + k, resolve: makeOrderlineResolver(k) });
                candidates.push({ name: 'orderline-' + k, resolve: makeOrderlineResolver(-k) });
            }
        }

        // ---- Nilai tiap kandidat ----
        function scoreCandidate(cand) {
            var seen = {}, hit = 0, resolvedCount = 0, duplicate = false;
            for (var i = 0; i < needLine.length; i++) {
                var ol = cand.resolve(needLine[i].__lineRaw, needLine[i]);
                if (ol === null || ol === undefined || ol === '') continue;
                resolvedCount++;
                if (seen[ol]) duplicate = true;
                seen[ol] = true;
                // validOrderlines (dari metode transform, SAMA kayak eksekusi asli) - BUKAN
                // ifIndex.orderlines (dari record.load ITEM_FULFILLMENT, TERBUKTI bisa beda angka).
                if (validOrderlines[ol]) hit++;
            }
            return { hit: hit, resolvedCount: resolvedCount, duplicate: duplicate };
        }

        var chosen = null, chosenScore = null;
        for (var c = 0; c < candidates.length; c++) {
            var sc = scoreCandidate(candidates[c]);
            if (chosen === null) { chosen = candidates[c]; chosenScore = sc; continue; }

            // Kandidat cuma menang kalau JELAS lebih baik - kalau seri, yang lebih depan (position) tetap dipakai
            var better = false;
            if (sc.hit > chosenScore.hit) better = true;
            else if (sc.hit === chosenScore.hit) {
                if (sc.resolvedCount > chosenScore.resolvedCount) better = true;
                else if (sc.resolvedCount === chosenScore.resolvedCount && chosenScore.duplicate && !sc.duplicate) better = true;
            }
            if (better) { chosen = candidates[c]; chosenScore = sc; }
        }

        // ---- Terapkan + validasi ----
        var applied = [];
        var notShipped = [];
        for (var r = 0; r < needLine.length; r++) {
            var ol2 = chosen.resolve(needLine[r].__lineRaw, needLine[r]);
            if (ol2 === null || ol2 === undefined || ol2 === '') {
                throw new Error("Item array index " + needLine[r].__payloadIndex + ": 'line' " + needLine[r].__lineRaw +
                    " gak bisa diterjemahkan ke orderline Transfer Order " + transferOrderId + " (mode: " + chosen.name + "). " +
                    "Kirim 'line_sequence'/'line_id' dari GET response, atau set 'line_mode'/'line_offset'.");
            }
            needLine[r].line_sequence = ol2;
            applied.push(needLine[r].__lineRaw + '->' + ol2);
            if (!validOrderlines[ol2]) notShipped.push(needLine[r].__lineRaw + '->' + ol2);
        }

        log.audit('LINE MAP', 'mode: ' + chosen.name +
            ' | cocok di fulfillment: ' + chosenScore.hit + '/' + needLine.length +
            ' | ' + applied.join(', '));

        if (chosenScore.duplicate) {
            log.error('LINE MAP DUPLICATE', 'Lebih dari satu payload item diterjemahkan ke orderline yang sama (mode: ' +
                chosen.name + '): ' + applied.join(', ') + '. Kirim ' + "'line_sequence'/'line_id' biar eksplisit.");
        }
        if (notShipped.length > 0) {
            log.audit('LINE NOT SHIPPED', 'Orderline ini gak ada di Item Fulfillment manapun: ' + notShipped.join(', '));
        }
    }

    // =========================================================
    // HELPER: Validasi ketersediaan SEBELUM bikin Item Receipt apapun (all-or-nothing)
    // =========================================================
    // Semua fulfillment_id udah diketahui dari awal (findEligibleFulfillments), jadi kita bisa
    // transform read-only (isDynamic:false, TANPA save) ke SEMUA fulfillment dulu, jumlahin total
    // qty yang tersedia per baris yang diminta, dan bandingkan sama qty yang diminta - SEBELUM
    // nyentuh save() sama sekali. Kalau kurang di baris manapun, TOLAK semuanya dari awal - gak ada
    // Item Receipt yang kebuat sama sekali (all-or-nothing), bukan "sebagian berhasil, sebagian kurang".
    function validateTransferOrderAvailability(transferOrderId, fulfillments, payloadItems, payloadMap) {
        var totalAvailable = {}; // key: line_sequence (orderline) -> total qty tersedia gabungan semua fulfillment

        for (var f = 0; f < fulfillments.length; f++) {
            var preview = record.transform({
                fromType: record.Type.TRANSFER_ORDER,
                fromId: transferOrderId,
                toType: record.Type.ITEM_RECEIPT,
                isDynamic: false,
                defaultValues: { itemfulfillment: fulfillments[f].id }
            });
            var lineCount = preview.getLineCount({ sublistId: 'item' });
            for (var i = 0; i < lineCount; i++) {
                var orderline = preview.getSublistValue({ sublistId: 'item', fieldId: 'orderline', line: i });
                var lineSeq = preview.getSublistValue({ sublistId: 'item', fieldId: 'line', line: i });
                var itemData = matchPayloadItem(payloadMap, i + 1, orderline, lineSeq, transferOrderId);
                if (!itemData) continue;

                var qty = parseFloat(preview.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
                var key = itemData.line_sequence !== undefined ? String(itemData.line_sequence) : String(itemData.line_id);
                totalAvailable[key] = (totalAvailable[key] || 0) + qty;
            }
        }

        var shortfalls = [];
        for (var x = 0; x < payloadItems.length; x++) {
            var pItem = payloadItems[x];
            var requested = (pItem.quantity !== undefined && pItem.quantity !== null) ? (parseFloat(pItem.quantity) || 0) : null;
            if (requested === null) continue; // gak ada qty eksplisit -> ambil semua yang ada, gak perlu divalidasi

            var key2 = pItem.line_sequence !== undefined ? String(pItem.line_sequence) : String(pItem.line_id);
            var avail = totalAvailable[key2] || 0;
            if (avail < requested) {
                var refLine = pItem.__lineRaw !== undefined
                    ? ('line ' + pItem.__lineRaw + ' -> orderline ' + key2)
                    : ('line_id ' + (pItem.line_id || '-'));
                shortfalls.push('index ' + x + ' (' + refLine + ', diminta ' + requested + ', tersedia ' + avail + ')');
            }
        }

        if (shortfalls.length > 0) {
            throw new Error(
                "Qty yang diminta melebihi total yang tersedia di seluruh Item Fulfillment Transfer Order " +
                transferOrderId + " - TIDAK ADA Item Receipt yang dibuat sama sekali: " + shortfalls.join('; ') +
                ". Kemungkinan sisanya belum di-Ship dari lokasi asal."
            );
        }
    }

    // =========================================================
    // CORE: Receive Transfer Order, auto-loop per Item Fulfillment kalau perlu
    // =========================================================
    // Cari semua Item Fulfillment milik TO (urut FIFO), lalu untuk tiap fulfillment yang MASIH
    // dibutuhkan, transform di-scope ke fulfillment itu spesifik (defaultValues.itemfulfillment -
    // TERBUKTI bisa selektif, baris lain di fulfillment yang sama boleh ditinggal unchecked tanpa
    // maksa full). Berhenti begitu qty yang diminta terpenuhi - fulfillment berikutnya (yang gak
    // dibutuhkan lagi) SAMA SEKALI gak disentuh, walau ada sisa stok item yang sama di situ.
    function receiveTransferOrder(params) {
        var transferOrderId = params.transfer_order_id;
        var payloadItems = params.items || params.lines;

        var fulfillments = findEligibleFulfillments(transferOrderId);
        if (fulfillments.length === 0) {
            throw new Error("Tidak ada Item Fulfillment yang ditemukan untuk Transfer Order " + transferOrderId + ". Pastikan sudah 'Shipped'.");
        }

        if (payloadItems && payloadItems.length > 0) {
            for (var k = 0; k < payloadItems.length; k++) {
                var item = payloadItems[k];

                // Kalau qty-nya ke-split ke beberapa Item Receipt (beberapa fulfillment), serial yang
                // sama gak bisa dobel-assign ke tiap batch - butuh pemetaan serial per fulfillment
                // yang belum didukung. Kirim per fulfillment_id manual buat baris yang ada serial-nya.
                if (item.serials && item.serials.length > 0) {
                    throw new Error("Item array index " + k + ": 'serials' tidak didukung lewat 'transfer_order_id' kalau qty-nya bisa ke-split ke beberapa Item Fulfillment. Kirim 'fulfillment_id' + 'transfer_order_id' spesifik buat baris ini.");
                }

                // 'line' disimpan dulu buat diagnostik (dipakai di response kalau ada yang kurang),
                // lalu dibuang - di jalur auto-split ini matching HARUS lewat 'line_sequence'
                // (orderline), karena posisi baris gak stabil antar Item Fulfillment.
                if (item.line !== undefined && item.line !== null) item.__lineRaw = item.line;
                delete item.line;

                var hasExplicitQty = item.quantity !== undefined && item.quantity !== null;
                item.__remaining = hasExplicitQty ? (parseFloat(item.quantity) || 0) : Infinity;
            }

            // Terjemahkan 'line' caller -> orderline (nomor baris TO). 'line' caller TIDAK selalu
            // sama dengan posisi baris di TO - lihat catatan panjang di resolveTransferOrderPayloadLines().
            resolveTransferOrderPayloadLines(transferOrderId, fulfillments, payloadItems, params);
        }

        var payloadMap = buildPayloadMap(payloadItems);

        // Validasi dulu SEBELUM bikin Item Receipt apapun - kalau total ketersediaan gabungan
        // semua fulfillment gak cukup, TOLAK dari awal (all-or-nothing), bukan bikin sebagian
        // lalu baru ketauan kurang belakangan.
        if (payloadItems && payloadItems.length > 0) {
            validateTransferOrderAvailability(transferOrderId, fulfillments, payloadItems, payloadMap);
        }

        var responseData = [];

        for (var f = 0; f < fulfillments.length; f++) {
            // Udah cukup -> stop, jangan sentuh fulfillment sisanya sama sekali
            if (payloadItems && payloadItems.length > 0 && allRequestsSatisfied(payloadItems)) break;

            log.audit('TO LOOP', 'Iterasi ' + f + ' | fulfillment_id: ' + fulfillments[f].id + ' | fulfillment_number: ' + fulfillments[f].tranid);

            // isDynamic:false (STANDARD MODE) - semua debug call yang berhasil selalu pakai mode ini
            // dan selalu nunjukin data benar, sedangkan dynamic mode (selectLine/commitLine) TERBUKTI
            // stale di transform berulang dalam 1 eksekusi. Lihat processReceiptLinesStandard().
            var itemReceipt = record.transform({
                fromType: record.Type.TRANSFER_ORDER,
                fromId: transferOrderId,
                toType: record.Type.ITEM_RECEIPT,
                isDynamic: false,
                defaultValues: { itemfulfillment: fulfillments[f].id }
            });

            setHeaderFields(itemReceipt, params);

            var itemChecked = processReceiptLinesStandard(itemReceipt, payloadItems, payloadMap, {
                isTransferOrder: true,
                isReturnAuth: false,
                sourceId: transferOrderId,
                allocate: !!(payloadItems && payloadItems.length > 0)
            });

            if (itemChecked === 0) {
                // Fulfillment ini gak nyumbang apa-apa buat baris yang diminta -> skip, lanjut
                continue;
            }

            var lineObj = saveItemReceiptAndBuildResponse(
                itemReceipt, params, transferOrderId, search.Type.TRANSFER_ORDER,
                'to_id', 'to_number', 'transfer_order'
            );

            responseData.push(lineObj);
        }

        if (responseData.length === 0) {
            throw new Error("Tidak ada item valid untuk di-receive dari Transfer Order " + transferOrderId + ". Pastikan sudah 'Shipped'.");
        }

        if (payloadItems && payloadItems.length > 0 && !allRequestsSatisfied(payloadItems)) {
            var shortfalls = [];
            for (var x = 0; x < payloadItems.length; x++) {
                var remaining = payloadItems[x].__remaining;
                if (remaining === Infinity || remaining > 0) {
                    // Sertakan 'line' asli dari caller + orderline hasil terjemahannya, biar kalau
                    // ternyata mapping-nya yang salah kelihatan dari response (bukan cuma "kurang").
                    var refLine = payloadItems[x].__lineRaw !== undefined
                        ? ('line ' + payloadItems[x].__lineRaw + ' -> orderline ' + (payloadItems[x].line_sequence !== undefined ? payloadItems[x].line_sequence : '-'))
                        : ('line_id ' + (payloadItems[x].line_id || '-'));
                    shortfalls.push('index ' + x + ' (' + refLine + ', kurang ' + (remaining === Infinity ? 'semua' : remaining) + ')');
                }
            }
            throw new Error(
                "Sebagian item berhasil di-receive (" + responseData.length + " Item Receipt dibuat: " +
                responseData.map(function (r) { return r.tranid; }).join(', ') +
                "), TAPI qty yang diminta belum terpenuhi semua - kurang di: " + shortfalls.join('; ') +
                ". Kemungkinan sisanya belum di-Ship dari lokasi asal."
            );
        }

        return responseData;
    }

    // =========================================================
    // CORE: Router - Buat Item Receipt dari PO, TO, Item Fulfillment, atau Return Auth
    // =========================================================
    function receiveItems(params) {
        if (params.po_id) {
            return [createOneReceipt(record.Type.PURCHASE_ORDER, params.po_id, params, {
                isTransferOrder: false, isReturnAuth: false,
                sourceRecordType: search.Type.PURCHASE_ORDER,
                sourceKey: 'po_id', sourceNumKey: 'po_number', sourceTypeName: 'purchase_order'
            })];
        }

        if (params.fulfillment_id) {
            if (!params.transfer_order_id) {
                throw new Error("'fulfillment_id' harus dikirim bareng 'transfer_order_id' (transform tetap dari Transfer Order, fulfillment_id cuma buat scoping ke 1 batch spesifik)");
            }
            return [createScopedFulfillmentReceipt(params.transfer_order_id, params.fulfillment_id, params)];
        }

        if (params.transfer_order_id) {
            return receiveTransferOrder(params);
        }

        if (params.customer_return_id) {
            return [createOneReceipt(record.Type.RETURN_AUTHORIZATION, params.customer_return_id, params, {
                isTransferOrder: false, isReturnAuth: true,
                sourceRecordType: search.Type.RETURN_AUTHORIZATION,
                sourceKey: 'customer_return_id', sourceNumKey: 'customer_return_number', sourceTypeName: 'customer_return'
            })];
        }

        throw new Error("'po_id', 'transfer_order_id', atau 'customer_return_id' wajib diisi");
    }

    // =========================================================
    // DEBUG: Investigasi struktur baris hasil transform TO -> Item Receipt
    // =========================================================
    // Read-only, TIDAK pernah save. Dipakai buat lihat field 'itemshipdoc' dkk yang menunjukkan
    // transform ini ter-scope ke Item Fulfillment mana.
    //
    // Kalau "fulfillment_id" diisi, dicoba scope transform ke Item Fulfillment itu spesifik lewat
    // defaultValues (terinspirasi dari URL native UI NetSuite: itemrcpt.nl?transform=trnfrord&
    // itemfulfillment=<ID>&id=<TO_ID>) - fromType TETAP TRANSFER_ORDER (bukan ITEM_FULFILLMENT,
    // itu yang ditolak NetSuite).
    function inspectTransferOrder(transferOrderId, fulfillmentId) {
        if (!transferOrderId) {
            throw new Error("'transfer_order_id' wajib diisi untuk mode debug");
        }

        var transformOpts = {
            fromType: record.Type.TRANSFER_ORDER,
            fromId: transferOrderId,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: false
        };

        if (fulfillmentId) {
            transformOpts.defaultValues = { itemfulfillment: fulfillmentId };
        }

        var itemReceipt = record.transform(transformOpts);

        var sublistFields = itemReceipt.getSublistFields({ sublistId: 'item' });
        var lineCount = itemReceipt.getLineCount({ sublistId: 'item' });
        var lines = [];

        for (var i = 0; i < lineCount; i++) {
            var lineData = { _line_index: i };
            for (var f = 0; f < sublistFields.length; f++) {
                var fieldId = sublistFields[f];
                try {
                    var v = itemReceipt.getSublistValue({ sublistId: 'item', fieldId: fieldId, line: i });
                    if (v !== '' && v !== null && v !== undefined) {
                        lineData[fieldId] = v;
                    }
                } catch (e) {
                    // field ini gak kebaca di baris ini, skip
                }
            }
            lines.push(lineData);
        }

        return {
            success: true,
            debug: true,
            transfer_order_id: transferOrderId,
            requested_fulfillment_id: fulfillmentId || null,
            line_count: lineCount,
            available_sublist_fields: sublistFields,
            lines: lines
        };
    }

    // =========================================================
    // RESTLET ENTRY POINT
    // =========================================================
    function post(params) {
        if (params.debug === true || params.debug === 'true') {
            try {
                if (params.to_line_map === true || params.to_line_map === 'true') {
                    // Test getTransferOrderLineMap() versi baru (posisi natural TO + orderline
                    // gabungan semua fulfillment, dicocokkan per item).
                    var fulfillmentsForMap = findEligibleFulfillments(params.transfer_order_id);
                    var ifLineIndex = getFulfillmentOrderlineIndex(fulfillmentsForMap);
                    return {
                        success: true,
                        debug: true,
                        transfer_order_id: params.transfer_order_id,
                        fulfillments_used: fulfillmentsForMap,
                        to_line_map: getTransferOrderLineMap(params.transfer_order_id, fulfillmentsForMap),
                        // Buat cek konvensi nomor baris caller: nomor baris Item Fulfillment -> orderline
                        fulfillment_lines: ifLineIndex.ifLineToOrderline,
                        orderlines_in_fulfillments: Object.keys(ifLineIndex.orderlines)
                    };
                }
                return inspectTransferOrder(params.transfer_order_id, params.fulfillment_id);
            } catch (e) {
                log.error('DEBUG ERROR', e);
                return { success: false, message: e.message };
            }
        }

        try {
            var result = receiveItems(params);
            var topKey = params.transfer_order_id ? 'transfer_order_id' : (params.customer_return_id ? 'customer_return_id' : 'purchase_order_id');
            var topVal = params.po_id || params.transfer_order_id || params.customer_return_id;
            var resp = {
                success: true,
                goods_receipts: result
            };
            resp[topKey] = topVal;
            return resp;
        } catch (e) {
            log.error('POST ERROR', e);
            return {
                success: false,
                message: e.message
            };
        }
    }

    return { post: post };
});
