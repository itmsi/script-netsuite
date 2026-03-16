/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Create Item Receipt dari Purchase Order via transform
 *
 * POST body:
 * {
 *   "po_id": 5157,                  // Internal ID Purchase Order (wajib)
 *   "trandate": "2026-03-11",       // Tanggal penerimaan (opsional, default: hari ini)
 *   "memo": "Catatan penerimaan",   // Memo header (opsional)
 *   "lines": [                      // Array baris yang akan diterima
 *     {
 *       "line_index": 0,            // Index baris (0-based) di PO
 *       "quantity": 1,              // Jumlah yang diterima
 *       "location": 5               // Internal ID lokasi penerimaan (opsional)
 *     }
 *   ]
 * }
 */

define(['N/record', 'N/format'], (record, format) => {

    const post = (body) => {

        try {

            let poId = body.po_id;

            if (!poId) {
                return {
                    status: 'error',
                    message: '"po_id" wajib diisi'
                };
            }

            // Transform Purchase Order → Item Receipt
            let itemReceipt = record.transform({
                fromType: record.Type.PURCHASE_ORDER,
                fromId: poId,
                toType: record.Type.ITEM_RECEIPT,
                isDynamic: true
            });

            // Set tanggal penerimaan
            if (body.trandate) {
                let parsedDate = format.parse({
                    value: body.trandate,
                    type: format.Type.DATE
                });
                itemReceipt.setValue({ fieldId: 'trandate', value: parsedDate });
            }

            // Set memo header
            if (body.memo !== undefined) {
                itemReceipt.setValue({ fieldId: 'memo', value: body.memo });
            }

            // Proses lines
            let linesToReceive = body.lines || [];
            let lineCount = itemReceipt.getLineCount({ sublistId: 'item' });

            // Default: tandai semua baris sebagai TIDAK diterima dulu
            for (let i = 0; i < lineCount; i++) {
                itemReceipt.selectLine({ sublistId: 'item', line: i });
                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    value: false
                });
                itemReceipt.commitLine({ sublistId: 'item' });
            }

            // Kemudian tandai hanya baris yang ada di body.lines
            if (linesToReceive.length > 0) {

                linesToReceive.forEach(lineData => {

                    let lineIndex = lineData.line_index;

                    if (lineIndex === undefined || lineIndex === null) {
                        throw new Error(`line_index wajib diisi di setiap baris`);
                    }
                    if (lineIndex >= lineCount) {
                        throw new Error(`line_index ${lineIndex} tidak valid. PO hanya punya ${lineCount} baris.`);
                    }

                    itemReceipt.selectLine({ sublistId: 'item', line: lineIndex });

                    // Tandai baris ini untuk diterima
                    itemReceipt.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        value: true
                    });

                    // Ensure item quantity matches the number of serials being processed
                    // This must be set BEFORE accessing inventorydetail
                    if (lineData.serials && Array.isArray(lineData.serials) && lineData.serials.length > 0) {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            value: lineData.serials.length
                        });
                    } else if (lineData.quantity !== undefined) {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            value: lineData.quantity
                        });
                    }

                    // Check apakah serials array ada di payload
                    if (lineData.serials && Array.isArray(lineData.serials) && lineData.serials.length > 0) {
                        try {
                            let inventoryDetail = itemReceipt.getCurrentSublistSubrecord({
                                sublistId: 'item',
                                fieldId: 'inventorydetail'
                            });

                            // Remove existing lines in inventorydetail if any (important when dealing with transformed records)
                            let currentDetailLines = inventoryDetail.getLineCount({ sublistId: 'inventoryassignment' });
                            for (let j = currentDetailLines - 1; j >= 0; j--) {
                                inventoryDetail.removeLine({ sublistId: 'inventoryassignment', line: j });
                            }

                            // Loop tiap serial number di array
                            lineData.serials.forEach((sn) => {
                                inventoryDetail.selectNewLine({
                                    sublistId: 'inventoryassignment'
                                });

                                // Untuk barang serial, tiap baris ID assignment selalu 1 qty
                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'receiptinventorynumber',
                                    value: sn
                                });

                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId: 'quantity',
                                    value: 1
                                });

                                inventoryDetail.commitLine({
                                    sublistId: 'inventoryassignment'
                                });
                            });
                        } catch (invErr) {
                            throw new Error('Gagal set serial number: ' + invErr.message);
                        }
                    }
                  
                    if (lineData.me_description) {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_me_description',
                            value: lineData.me_description
                        });
                    }
                    // Set location penerimaan
                    if (lineData.location !== undefined) {
                        itemReceipt.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'location',
                            value: lineData.location
                        });
                    }

                    itemReceipt.commitLine({ sublistId: 'item' });

                });

            } else {

                // Kalau lines tidak dikirim → terima semua baris dengan qty default
                for (let i = 0; i < lineCount; i++) {
                    itemReceipt.selectLine({ sublistId: 'item', line: i });
                    itemReceipt.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        value: true
                    });
                    itemReceipt.commitLine({ sublistId: 'item' });
                }

            }

            // Simpan Item Receipt
            let newId = itemReceipt.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

            return {
                status: 'success',
                message: 'Item Receipt berhasil dibuat',
                item_receipt_id: newId,
                created_from_po: poId
            };

        } catch (error) {
            return {
                status: "error",
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }
    };

    return { post };

});
