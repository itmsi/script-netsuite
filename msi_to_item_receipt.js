/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Create Item Receipt dari Transfer Order via transform
 *
 * POST body:
 {
   "transfer_order_id": 123,          // Internal ID Transfer Order (wajib)
   "trandate"         : "2026-03-25", // Tanggal penerimaan (opsional, default: hari ini)
   "memo"             : "Catatan",    // Memo header (opsional)
   "lines": [                         // Array baris yang akan diterima
     {
       "line_index": 0,               // Index baris 0-based di Transfer Order
       "quantity"  : 2,               // Jumlah yang diterima
       "location"  : 5,               // Internal ID lokasi tujuan (opsional)
       "serials"   : [101, 102]       // Array internal ID serial/lot (opsional)
     }
   ]
 }
 *
 * Catatan:
 * - Jika "lines" tidak dikirim → semua baris akan diterima dengan qty default
 * - Jika serials dikirim → quantity otomatis = jumlah serials
 */
define(['N/record', 'N/format', 'N/log'], function (record, format, log) {

    function post(body) {
        try {

            var toId = body.transfer_order_id;

            if (!toId) {
                return {
                    status : 'error',
                    message: '"transfer_order_id" wajib diisi'
                };
            }

            // =========================
            // 🔥 TRANSFORM: Transfer Order → Item Receipt
            // =========================
            var itemReceipt = record.transform({
                fromType : record.Type.TRANSFER_ORDER,
                fromId   : toId,
                toType   : record.Type.ITEM_RECEIPT,
                isDynamic: true
            });

            // Set tanggal penerimaan
            if (body.trandate) {
                var dateObj;
                var t = body.trandate;
                var parts;
                
                if (t.indexOf('-') > -1 && t.split('-')[0].length === 4) {
                    // YYYY-MM-DD
                    parts = t.split('-');
                    dateObj = new Date(parts[0], parseInt(parts[1], 10) - 1, parts[2]);
                } else if (t.indexOf('-') > -1 && t.split('-')[2].length === 4) {
                    // DD-MM-YYYY
                    parts = t.split('-');
                    dateObj = new Date(parts[2], parseInt(parts[1], 10) - 1, parts[0]);
                } else if (t.indexOf('/') > -1 && t.split('/')[2].length === 4) {
                    // DD/MM/YYYY
                    parts = t.split('/');
                    dateObj = new Date(parts[2], parseInt(parts[1], 10) - 1, parts[0]);
                } else {
                    // Fallback to N/format if arbitrary format
                    try {
                        dateObj = format.parse({
                            value: t,
                            type : format.Type.DATE
                        });
                    } catch(e) {
                        dateObj = new Date(t);
                    }
                }

                if (!dateObj || isNaN(dateObj.getTime())) {
                    throw new Error("Format trandate tidak valid. Gunakan format YYYY-MM-DD atau DD/MM/YYYY. Input: " + t);
                }

                itemReceipt.setValue({ fieldId: 'trandate', value: dateObj });
            }

            // Set memo header
            if (body.memo !== undefined) {
                itemReceipt.setValue({ fieldId: 'memo', value: body.memo });
            }

            var linesToReceive = body.lines || [];
            var lineCount      = itemReceipt.getLineCount({ sublistId: 'item' });

            // =========================
            // 🔥 DEFAULT: matikan semua baris dulu
            // =========================
            for (var i = 0; i < lineCount; i++) {
                itemReceipt.selectLine({ sublistId: 'item', line: i });
                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId  : 'itemreceive',
                    value    : false
                });
                itemReceipt.commitLine({ sublistId: 'item' });
            }

            // =========================
            // 🔥 PROSES LINES
            // =========================
            if (linesToReceive.length > 0) {

                for (var l = 0; l < linesToReceive.length; l++) {
                    var lineData  = linesToReceive[l];
                    var lineIndex = lineData.line_index;

                    if (lineIndex === undefined || lineIndex === null) {
                        throw new Error('line_index wajib diisi di setiap baris');
                    }
                    if (lineIndex >= lineCount) {
                        throw new Error('line_index ' + lineIndex + ' tidak valid. TO hanya punya ' + lineCount + ' baris.');
                    }

                    itemReceipt.selectLine({ sublistId: 'item', line: lineIndex });

                    // Tandai untuk diterima
                    itemReceipt.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId  : 'itemreceive',
                        value    : true
                    });

                    // Set quantity
                    if (lineData.serials && lineData.serials.length > 0) {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId  : 'quantity',
                            value    : lineData.serials.length
                        });
                    } else if (lineData.quantity !== undefined) {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId  : 'quantity',
                            value    : lineData.quantity
                        });
                    }

                    // Set lokasi tujuan
                    if (lineData.location !== undefined) {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId  : 'location',
                            value    : lineData.location
                        });
                    }

                    // =========================
                    // 🔥 INVENTORY DETAIL (serial/lot)
                    // =========================
                    if (lineData.serials && lineData.serials.length > 0) {
                        try {
                            var inventoryDetail = itemReceipt.getCurrentSublistSubrecord({
                                sublistId: 'item',
                                fieldId  : 'inventorydetail'
                            });

                            // Hapus existing lines dulu (dari transform)
                            var existingLines = inventoryDetail.getLineCount({ sublistId: 'inventoryassignment' });
                            for (var j = existingLines - 1; j >= 0; j--) {
                                inventoryDetail.removeLine({ sublistId: 'inventoryassignment', line: j });
                            }

                            for (var s = 0; s < lineData.serials.length; s++) {
                                inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });

                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId  : 'receiptinventorynumber',
                                    value    : lineData.serials[s]
                                });

                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId  : 'quantity',
                                    value    : 1
                                });

                                inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
                            }

                        } catch (invErr) {
                            throw new Error('Gagal set serial number baris ' + lineIndex + ': ' + invErr.message);
                        }
                    }

                    itemReceipt.commitLine({ sublistId: 'item' });
                }

            } else {

                // Tidak ada lines di payload → terima semua baris dengan qty default
                for (var k = 0; k < lineCount; k++) {
                    itemReceipt.selectLine({ sublistId: 'item', line: k });
                    itemReceipt.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId  : 'itemreceive',
                        value    : true
                    });
                    itemReceipt.commitLine({ sublistId: 'item' });
                }

            }

            // =========================
            // 🔥 SAVE
            // =========================
            var newId = itemReceipt.save({
                enableSourcing      : true,
                ignoreMandatoryFields: false
            });

            return {
                status              : 'success',
                message             : 'Item Receipt berhasil dibuat dari Transfer Order',
                item_receipt_id     : newId,
                created_from_to     : toId
            };

        } catch (e) {
            log.error('ERROR', e);
            return {
                status : 'error',
                name   : e.name,
                message: e.message,
                stack  : e.stack
            };
        }
    }

    return { post: post };
});
