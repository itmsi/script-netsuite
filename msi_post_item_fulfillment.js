/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 *  "sales_order_id": 5157,               // Internal ID Sales Order
 *  "transfer_order_id": 1234,   // Internal ID Transfer Order
 *  "vendor_return_id": 5678,    // Internal ID Vendor Return Authorization
 *  "memo": "Catatan fulfillment",         // opsional
 */
define(['N/record', 'N/log', 'N/search', 'N/runtime'], function (record, log, search, runtime) {

    function post(context) {

        try {

            var fulfillment;

            // 🔥 MODE UPDATE: kalau "id" (internal id Item Fulfillment yang sudah ada) dikirim,
            // load record itu langsung - TIDAK perlu transform lagi. record.load() bekerja sama
            // untuk semua tipe record NetSuite, terlepas dari record itu awalnya dibuat lewat
            // record.create() atau record.transform() - jadi mekanismenya SAMA dengan script
            // lain (mis. msi_post_sales_order.js) yang juga pakai pola "ada id -> load, kalau
            // tidak -> create/transform". Yang beda antar tipe cuma nama field & sublist-nya,
            // bukan mekanisme update-nya.
            if (context.id) {

                fulfillment = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: context.id,
                    isDynamic: true
                });

            } else {

                var soId = context.sales_order_id;
                var toId = context.transfer_order_id;
                var vrId = context.vendor_return_id;

                // Deteksi tipe order: SO atau TO atau VR
                var sourceId, sourceType;

                if (soId) {
                    sourceId = soId;
                    sourceType = record.Type.SALES_ORDER;
                } else if (toId) {
                    sourceId = toId;
                    sourceType = record.Type.TRANSFER_ORDER;
                } else if (vrId) {
                    sourceId = vrId;
                    sourceType = record.Type.VENDOR_RETURN_AUTHORIZATION;
                } else {
                    return {
                        status: 'error',
                        message: '"id" (untuk update Item Fulfillment yang sudah ada) atau salah satu dari sales_order_id, transfer_order_id, vendor_return_id (untuk membuat baru) harus diisi'
                    };
                }

                fulfillment = record.transform({
                    fromType: sourceType,
                    fromId: sourceId,
                    toType: record.Type.ITEM_FULFILLMENT,
                    isDynamic: true
                });
            }

            // 🔥 Opsional: User bisa ganti custom form
            if (context.customform) {
                fulfillment.setValue({ fieldId: 'customform', value: context.customform });
            }

            // 🔥 Opsional: memo header
            if (context.memo !== undefined && context.memo !== null) {
                try {
                    fulfillment.setValue({ fieldId: 'memo', value: context.memo });
                } catch (memoErr) {
                    log.error('SET MEMO ERROR', memoErr.message);
                }
            }

            // PENTING: jangan pakai new Date(string) untuk string "YYYY-MM-DD" -
            // itu diparse sebagai UTC midnight, lalu NetSuite convert ke timezone
            // akun (biasanya mundur dari UTC) sehingga tanggalnya jadi mundur 1 hari.
            // Makanya parsing manual ke komponen local date (y, m-1, d) diprioritaskan.
            if (context.trandate) {
                try {
                    var d;
                    var dateParts = String(context.trandate).split(/[-\/]/);
                    if (dateParts.length === 3) {
                        d = dateParts[0].length === 4
                            ? new Date(+dateParts[0], +dateParts[1] - 1, +dateParts[2])   // YYYY-MM-DD
                            : new Date(+dateParts[2], +dateParts[1] - 1, +dateParts[0]);  // DD-MM-YYYY
                    } else {
                        d = new Date(context.trandate);
                    }
                    if (d && !isNaN(d.getTime())) {
                        fulfillment.setValue({ fieldId: 'trandate', value: d });
                    } else {
                        log.error('SET TRANDATE ERROR', 'Format trandate tidak valid: ' + context.trandate);
                    }
                } catch (dateErr) {
                    log.error('SET TRANDATE ERROR', dateErr.message);
                }
            }

            // 🔥 (BARU) Auto-map semua custom fields dari body ke header Item Fulfillment
            for (var key in context) {
                if (key.indexOf('custbody') === 0) {
                    try {
                        fulfillment.setValue({ fieldId: key, value: context[key] });
                    } catch (custErr) {
                        log.error('SET CUSTOM FIELD ERROR', 'Field: ' + key + ' Error: ' + custErr.message);
                    }
                }
            }

            var lineCount = fulfillment.getLineCount({
                sublistId: 'item'
            });

            var isUpdateMode = !!context.id;

            var hasValidLine = false;

            var payloadItems = context.items || [];

            // 🔥 MODE UPDATE tanpa "items": anggap ini update header-only (mis. cuma ganti memo /
            // custom field) - jangan sentuh sublist 'item' sama sekali, biar baris yang sudah
            // di-fulfill sebelumnya TIDAK ikut ter-uncheck.
            var skipLineLoop = isUpdateMode && payloadItems.length === 0;
            if (skipLineLoop) {
                hasValidLine = true;
            }

            // 🔥 Mode update: kumpulkan baris yang qty-nya diminta MELEBIHI qty yang masih bisa
            // di-fulfill dari dokumen asal (SO/TO/VR) - dilaporkan sebagai error, bukan
            // di-silent-clamp kayak mode create.
            var qtyViolations = [];

            // =========================
            // 🔥 LOOP LINE NETSUITE
            // =========================
            for (var i = 0; !skipLineLoop && i < lineCount; i++) {

                fulfillment.selectLine({
                    sublistId: 'item',
                    line: i
                });

                var qtyRemaining = fulfillment.getCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantityremaining'
                });

                var needInvDetail = fulfillment.getCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'inventorydetailreq'
                });

                if (qtyRemaining <= 0) {
                    // FIX Bug 1: explicitly deselect — transform sets itemreceive=true by default.
                    // Di mode update, baris yang sudah punya status (dari save sebelumnya) dibiarkan
                    // apa adanya - jangan dipaksa uncheck.
                    if (!isUpdateMode) {
                        fulfillment.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'itemreceive',
                            value: false
                        });
                    }
                    fulfillment.commitLine({ sublistId: 'item' });
                    continue;
                }

                // =========================
                // 🔥 CARI PAYLOAD YANG MATCH
                // =========================
                var matchedItem = null;

                for (var p = 0; p < payloadItems.length; p++) {

                    var payloadLine = payloadItems[p].line;

                    // 🔥 handle line_number dari API (1-based)
                    if (payloadLine && (payloadLine - 1) == i) {
                        matchedItem = payloadItems[p];
                        break;
                    }
                }

                // kalau tidak ada di payload → skip
                // FIX Bug 1: explicitly deselect — transform sets itemreceive=true by default.
                // Di mode update, baris yang gak disebut di payload dibiarkan apa adanya - hanya
                // baris yang eksplisit dikirim di "items" yang diubah.
                if (!matchedItem) {
                    if (!isUpdateMode) {
                        fulfillment.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'itemreceive',
                            value: false
                        });
                    }
                    fulfillment.commitLine({ sublistId: 'item' });
                    continue;
                }

                hasValidLine = true;

                // =========================
                // ✅ SET RECEIVE
                // =========================
                fulfillment.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    value: true
                });

                var serials = matchedItem.serials || [];
                var payloadQty = matchedItem.quantity;

                var qtyToFulfill;

                if (serials && serials.length > 0) {
                    // Pakai serial → qty = jumlah serial (1 serial = 1 unit)
                    qtyToFulfill = serials.length;
                } else if (payloadQty === 0) {
                    // Explicitly 0 → skip line ini
                    fulfillment.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        value: false
                    });
                    fulfillment.commitLine({ sublistId: 'item' });
                    continue;
                } else if (payloadQty !== null && payloadQty !== undefined && payloadQty > 0) {
                    // Qty di-set explicit → pakai qty dari payload
                    qtyToFulfill = payloadQty;
                } else {
                    // quantity tidak dikirim (undefined) → default fulfill semua sisa
                    qtyToFulfill = qtyRemaining;
                }

                // jangan lebih dari remaining
                if (qtyToFulfill > qtyRemaining) {
                    if (isUpdateMode) {
                        qtyViolations.push(
                            'Baris ' + (i + 1) + ': diminta ' + qtyToFulfill +
                            ', tapi yang masih bisa di-fulfill dari dokumen asal cuma tersisa ' + qtyRemaining
                        );
                    }
                    qtyToFulfill = qtyRemaining;
                }

                fulfillment.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    value: qtyToFulfill
                });

                // 🔥 (BARU) Auto-map custom fields per baris (dimulai dengan custcol_)
                // Contoh: "custcol_me_status": 1
                for (var lineKey in matchedItem) {
                    if (lineKey.indexOf('custcol') === 0) {
                        try {
                            fulfillment.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: lineKey,
                                value: matchedItem[lineKey]
                            });
                        } catch (lineErr) {
                            log.error('SET LINE FIELD ERROR', 'Field: ' + lineKey + ' Error: ' + lineErr.message);
                        }
                    }
                }

                // =========================
                // 🔥 INVENTORY DETAIL
                // =========================
                if (needInvDetail) {

                    var inventoryDetail = fulfillment.getCurrentSublistSubrecord({
                        sublistId: 'item',
                        fieldId: 'inventorydetail'
                    });

                    if (serials.length > 0) {

                        // Hapus line default yang ditarik oleh NetSuite (jika ada)
                        // agar tidak bentrok dengan serial dari API
                        var existingDetailLines = inventoryDetail.getLineCount({
                            sublistId: 'inventoryassignment'
                        });
                        for (var r = existingDetailLines - 1; r >= 0; r--) {
                            inventoryDetail.removeLine({
                                sublistId: 'inventoryassignment',
                                line: r
                            });
                        }

                        for (var s = 0; s < serials.length; s++) {

                            var sn = serials[s];

                            inventoryDetail.selectNewLine({
                                sublistId: 'inventoryassignment'
                            });

                            try {
                                inventoryDetail.setCurrentSublistText({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'issueinventorynumber',
                                    text: String(sn)
                                });
                            } catch (e) {
                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'issueinventorynumber',
                                    value: sn
                                });
                            }

                            // Set Inventory Status jika diaktifkan (Default: 1 / Good)
                            // Inilah field "Status" yang membuat error di baris 191
                            var invStatus = matchedItem.inventorystatus || 1;
                            try {
                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'inventorystatus',
                                    value: invStatus
                                });
                            } catch (statusErr) {
                                // Abaikan jika fitur Inventory Status tidak dipakai,
                                // error yang lebih spesifik akan ditangkap saat commitLine jika memang wajib.
                            }

                            inventoryDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'quantity',
                                value: 1
                            });

                            inventoryDetail.commitLine({
                                sublistId: 'inventoryassignment'
                            });
                        }

                    } else {

                        // 🔥 Item butuh inventory detail TAPI TIDAK pakai serial/lot number (mis.
                        // cuma fitur "Multiple Inventory Status" - baris detail cuma punya
                        // Status + Quantity, tanpa identitas unik). Kalau ini dibiarkan, waktu
                        // qtyToFulfill diubah (mis. update qty 10 -> 11) tapi baris inventory detail
                        // yang lama masih total 10, NetSuite tolak: "Please configure the inventory
                        // detail in line X". Jadi total quantity di inventory detail perlu
                        // disamakan (reconcile) ke qtyToFulfill yang baru.
                        reconcileInventoryDetailQuantity(
                            inventoryDetail,
                            qtyToFulfill,
                            matchedItem.inventorystatus || 1
                        );
                    }
                }

                fulfillment.commitLine({
                    sublistId: 'item'
                });
            }

            if (qtyViolations.length > 0) {
                return {
                    status: 'error',
                    message: 'Qty yang diminta melebihi qty yang masih bisa di-fulfill dari dokumen asal: ' + qtyViolations.join('; ')
                };
            }

            if (!hasValidLine) {
                return {
                    status: 'error',
                    message: 'Tidak ada item valid untuk fulfill'
                };
            }

            // Set Status sebelum di save.
            // Mode update: kalau caller gak eksplisit kirim ship_status, JANGAN dipaksa ke
            // 'shipped' - biarkan status yang sudah ada di record. Di mode create, default 'shipped'
            // tetap dipertahankan (perilaku lama).
            var explicitStatus = context.ship_status || context.shipstatus;
            var statusStr = (explicitStatus || (isUpdateMode ? null : 'shipped'));

            if (statusStr) {
                statusStr = statusStr.toLowerCase();
                var statusCode = statusStr === 'picked' ? 'A' : statusStr === 'packed' ? 'B' : 'C';
                var statusText = statusStr === 'picked' ? 'Picked' : statusStr === 'packed' ? 'Packed' : 'Shipped';

                try {
                    fulfillment.setValue({
                        fieldId: 'shipstatus',
                        value: statusCode
                    });
                } catch (e) {
                    try {
                        fulfillment.setText({
                            fieldId: 'shipstatus',
                            text: statusText
                        });
                    } catch (e2) {
                        log.error('SET SHIPSTATUS ERROR', e2.message);
                    }
                }
            }

            // 🔥 Auto-Approve: set approval status ke 'Approved' sebelum save
            // Mode create: default true (perilaku lama) - kirim "auto_approve": false untuk skip.
            // Mode update: default FALSE (jangan sentuh approval yang sudah ada) - kirim
            // "auto_approve": true secara eksplisit kalau memang mau approve saat update.
            var shouldAutoApprove = isUpdateMode
                ? context.auto_approve === true
                : context.auto_approve !== false;
            if (shouldAutoApprove) {
                try {
                    fulfillment.setValue({ fieldId: 'approvalstatus', value: 'A' }); // A = Approved
                } catch (approveErr) {
                    log.error('SET APPROVAL STATUS ERROR', approveErr.message);
                }
            }

            var fulfillmentId = fulfillment.save({
                enableSourcing: true,
                ignoreMandatoryFields: true // Bypass UI validation errors for standard fields mapped dynamically
            });

            // 🔥 Safety-net: enableSourcing di save() di atas bisa re-source field
            // dari SO/TO asal dan menimpa memo yang sudah di-set sebelum save.
            // Set ulang via submitFields (tanpa sourcing) supaya memo pasti nempel.
            if (context.memo !== undefined && context.memo !== null) {
                try {
                    record.submitFields({
                        type: record.Type.ITEM_FULFILLMENT,
                        id: fulfillmentId,
                        values: { memo: context.memo },
                        options: { enablesourcing: false, ignoreMandatoryFields: true }
                    });
                } catch (memoSubmitErr) {
                    log.error('SET MEMO ERROR (submitFields)', memoSubmitErr.message);
                }
            }

             // 28 Juli 2026 Dharma Create Add note after save success
            // ==============================
            // CREATE NOTE (FIRST)
            // ==============================
            if (context.note && context.note.trim() !== "") {

                var noteRec = record.create({
                    type: 'note',
                    isDynamic: true
                });

                noteRec.setValue({
                    fieldId: 'title',
                    value: context.noteTitle || 'API Note'
                });

                noteRec.setValue({
                    fieldId: 'note',
                    value: context.note
                });

                noteRec.setValue({
                    fieldId: 'transaction',
                    value: fulfillmentId 
                });

                noteRec.setValue({
                    fieldId: 'author',
                    value: runtime.getCurrentUser().id
                });

                noteId = noteRec.save();
            }

            // Ambil nomor dokumen (tranid) dari Item Fulfillment yang baru dibuat
            var docId = '';
            try {
                var ifFields = search.lookupFields({
                    type: search.Type.ITEM_FULFILLMENT,
                    id: fulfillmentId,
                    columns: ['tranid']
                });
                docId = ifFields.tranid || '';
            } catch (lookupErr) {
                log.error('LOOKUP TRANID ERROR', lookupErr.message);
            }

            return {
                status: 'success',
                fulfillment_id: fulfillmentId,
                doc_id: docId
            };

        } catch (e) {

            log.error('ERROR', e);

            return {
                status: 'error',
                message: e.message
            };
        }
    }

    // =========================================================
    // HELPER: Samakan (reconcile) total quantity inventory detail dengan qty baris,
    // untuk item yang butuh inventory detail TAPI TIDAK pakai serial/lot number
    // (mis. cuma "Multiple Inventory Status" - baris detail cuma Status + Quantity).
    // =========================================================
    function reconcileInventoryDetailQuantity(inventoryDetail, targetQty, defaultStatus) {

        var lineCount = inventoryDetail.getLineCount({ sublistId: 'inventoryassignment' });

        if (lineCount === 0) {
            // Belum ada baris detail sama sekali -> buat 1 baris untuk seluruh qty
            inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });
            try {
                inventoryDetail.setCurrentSublistValue({
                    sublistId: 'inventoryassignment',
                    fieldId: 'inventorystatus',
                    value: defaultStatus
                });
            } catch (e) {
                // Abaikan jika fitur Inventory Status tidak aktif untuk item ini
            }
            inventoryDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'quantity',
                value: targetQty
            });
            inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
            return;
        }

        var currentTotal = 0;
        for (var i = 0; i < lineCount; i++) {
            currentTotal += parseFloat(inventoryDetail.getSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'quantity',
                line: i
            })) || 0;
        }

        var delta = targetQty - currentTotal;
        if (delta === 0) return;

        // Selisihnya ditambahkan/dikurangkan ke baris TERAKHIR - paling simpel, gak perlu tau
        // baris mana yang "benar" kalau kebetulan ada lebih dari 1 status.
        var lastIndex = lineCount - 1;
        inventoryDetail.selectLine({ sublistId: 'inventoryassignment', line: lastIndex });
        var lastQty = parseFloat(inventoryDetail.getCurrentSublistValue({
            sublistId: 'inventoryassignment',
            fieldId: 'quantity'
        })) || 0;
        var newQty = lastQty + delta;

        if (newQty <= 0) {
            // Pengurangan bikin baris terakhir jadi <=0 -> hapus baris itu. Kasus qty berkurang
            // banyak sekaligus baris status > 1 gak ditangani sepenuhnya di sini - cukup jarang
            // terjadi (biasanya cuma 1 baris status per baris fulfillment).
            inventoryDetail.cancelLine({ sublistId: 'inventoryassignment' });
            inventoryDetail.removeLine({ sublistId: 'inventoryassignment', line: lastIndex });
        } else {
            inventoryDetail.setCurrentSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'quantity',
                value: newQty
            });
            inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
        }
    }

    return {
        post: post
    };
});