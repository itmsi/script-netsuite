/**
 * @NApiVersion 2.1
 * @NScriptType Restlet

 Create Item Receipt dari Purchase Order atau Transfer Order via transform.
 Gabungan MSI_Item_Receipt.js + msi_post_receive_item_po.js

 POST body:
 {
   // Salah satu wajib diisi:
   "po_id": 5157,               // Internal ID Purchase Order
   "transfer_order_id": 1234,   // Internal ID Transfer Order

   // Header (opsional):
   "trandate": "2026-03-11",    // format: YYYY-MM-DD atau DD-MM-YYYY
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
       "serials": ["SN001"],    // opsional: array serial number
       // custcol_* fields juga otomatis di-map
     }
   ]
 }

 * Kalau "items" tidak dikirim -> semua baris di-receive dengan qty sisa default.
 */
define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    // =========================================================
    // CORE: Buat Item Receipt dari PO atau TO
    // =========================================================
    function receiveItems(params) {

        // 1. Deteksi tipe sumber
        var sourceId, sourceType, isTransferOrder;

        if (params.po_id) {
            sourceId = params.po_id;
            sourceType = record.Type.PURCHASE_ORDER;
            isTransferOrder = false;
        } else if (params.transfer_order_id) {
            sourceId = params.transfer_order_id;
            sourceType = record.Type.TRANSFER_ORDER;
            isTransferOrder = true;
        } else {
            throw new Error("'po_id' atau 'transfer_order_id' wajib diisi");
        }

        // 2. Transform ke Item Receipt
        var itemReceipt = record.transform({
            fromType: sourceType,
            fromId: sourceId,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: true  // wajib true untuk akses inventorydetail subrecord (serial)
        });

        // 3. Set header fields

        // trandate: support YYYY-MM-DD dan DD-MM-YYYY
        if (params.trandate) {
            var d = new Date(params.trandate);
            if (isNaN(d.getTime())) {
                var parts = params.trandate.split(/[-\/]/);
                if (parts.length === 3) {
                    d = parts[0].length === 4
                        ? new Date(+parts[0], +parts[1] - 1, +parts[2])   // YYYY-MM-DD
                        : new Date(+parts[2], +parts[1] - 1, +parts[0]);  // DD-MM-YYYY
                }
            }
            if (!isNaN(d.getTime())) {
                itemReceipt.setValue({ fieldId: 'trandate', value: d });
            }
        }

        // Standard header fields
        ['memo', 'customform', 'class', 'location', 'department'].forEach(function (field) {
            if (params[field] !== undefined && params[field] !== null) {
                itemReceipt.setValue({ fieldId: field, value: params[field] });
            }
        });

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

        // 4. Siapkan map payload untuk pencarian O(1)
        var payloadItems = params.items || params.lines; // Support format lama "lines"
        var payloadMap = {};

        if (payloadItems && payloadItems.length > 0) {
            for (var x = 0; x < payloadItems.length; x++) {
                var pItem = payloadItems[x];
                var hasLine = pItem.line !== undefined && pItem.line !== null;
                var hasSeq = pItem.line_sequence !== undefined && pItem.line_sequence !== null;

                if (!hasLine && !hasSeq) {
                    throw new Error("Item array index " + x + ": 'line' (1-based) wajib diisi");
                }

                // 'line' adalah 1-based (1, 2, 3, ...)
                if (hasLine) payloadMap['line_' + parseInt(pItem.line, 10)] = pItem;
                // Fallback: line_sequence (orderline internal NetSuite) juga masih didukung
                if (hasSeq) payloadMap['seq_' + pItem.line_sequence] = pItem;
            }
        }

        // 5. Loop baris NetSuite (Single Pass)
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
            var itemData = payloadMap['line_' + lineNum] ||
                (orderline ? payloadMap['seq_' + String(orderline)] : null) ||
                (lineSeq ? payloadMap['seq_' + String(lineSeq)] : null);

            if (!itemData) {
                // Tidak ada di payload -> uncheck
                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item', fieldId: 'itemreceive', value: false
                });
                itemReceipt.commitLine({ sublistId: 'item' });
                continue;
            }

            // Set itemreceive = true
            itemReceipt.setCurrentSublistValue({
                sublistId: 'item', fieldId: 'itemreceive', value: true
            });

            var serials = itemData.serials || [];
            var qty;

            if (serials.length > 0) {
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

            if (!isTransferOrder && itemData.rate !== undefined && itemData.rate !== null) {
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

        if (itemChecked === 0) {
            throw new Error("Tidak ada item valid untuk di-receive. Pastikan sudah 'Shipped'.");
        }

        // 6. Save
        var irId;
        try {
            irId = itemReceipt.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });
        } catch (saveErr) {
            if (saveErr.message && saveErr.message.indexOf('You can not receive more') > -1) {
                throw new Error("Gagal Save: Tidak bisa menerima barang dari Transfer Order. Kemungkinan penyebab: (1) Item Fulfillment terkait belum di-Approve (cek Approval Status di IF), (2) Kuantitas melebihi jumlah yang di-Shipped, atau (3) Barang sudah pernah di-receive sebelumnya. Detail: " + saveErr.message);
            }
            throw saveErr;
        }

        // 7. Build response
        var responseData = [];
        try {
            var irFields = search.lookupFields({
                type: search.Type.ITEM_RECEIPT,
                id: irId,
                columns: ['tranid', 'trandate']
            });

            var sourceRecordType = isTransferOrder
                ? search.Type.TRANSFER_ORDER
                : search.Type.PURCHASE_ORDER;

            var sourceFields = search.lookupFields({
                type: sourceRecordType,
                id: sourceId,
                columns: ['tranid']
            });

            var sourceTranId = Array.isArray(sourceFields.tranid)
                ? (sourceFields.tranid.length > 0 ? sourceFields.tranid[0].text : '')
                : (sourceFields.tranid || '');

            var sourceKey = isTransferOrder ? 'to_id' : 'po_id';
            var sourceNumKey = isTransferOrder ? 'to_number' : 'po_number';

            var lineObj = {
                id: irId,
                tranid: irFields.tranid || '',
                trandate: irFields.trandate || '',
                source_type: isTransferOrder ? 'transfer_order' : 'purchase_order'
            };
            lineObj[sourceKey] = sourceId;
            lineObj[sourceNumKey] = sourceTranId;

            responseData.push(lineObj);

        } catch (e) {
            log.error('ERROR fetch IR info', e.message);
            // Tetap kembalikan irId meskipun lookupFields gagal
            responseData.push({ id: irId, po_id: sourceId });
        }

        return responseData;
    }

    // =========================================================
    // RESTLET ENTRY POINT
    // =========================================================
    function post(params) {
        try {
            var result = receiveItems(params);
            var topKey = params.transfer_order_id ? 'transfer_order_id' : 'purchase_order_id';
            var topVal = params.po_id || params.transfer_order_id;
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
