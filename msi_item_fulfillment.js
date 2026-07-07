/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 *  "sales_order_id": 5157,               // Internal ID Purchase Order
 *  "transfer_order_id": 1234,   // Internal ID Transfer Order
 */
define(['N/record', 'N/log', 'N/search'], function (record, log, search) {

    function post(context) {

        try {

            var soId = context.sales_order_id;
            var toId = context.transfer_order_id;

            // Deteksi tipe order: SO atau TO
            var sourceId, sourceType, isTransferOrder;

            if (soId) {
                sourceId = soId;
                sourceType = record.Type.SALES_ORDER;
                isTransferOrder = false;
            } else if (toId) {
                sourceId = toId;
                sourceType = record.Type.TRANSFER_ORDER;
                isTransferOrder = true;
            } else {
                return {
                    status: 'error',
                    message: 'sales_order_id atau transfer_order_id harus diisi'
                };
            }

            var fulfillment = record.transform({
                fromType: sourceType,
                fromId: sourceId,
                toType: record.Type.ITEM_FULFILLMENT,
                isDynamic: true
            });

            // 🔥 Opsional: User bisa ganti custom form
            if (context.customform) {
                fulfillment.setValue({ fieldId: 'customform', value: context.customform });
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

            var hasValidLine = false;

            var payloadItems = context.items || [];

            // =========================
            // 🔥 LOOP LINE NETSUITE
            // =========================
            for (var i = 0; i < lineCount; i++) {

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
                    // FIX Bug 1: explicitly deselect — transform sets itemreceive=true by default
                    fulfillment.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        value: false
                    });
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
                // FIX Bug 1: explicitly deselect — transform sets itemreceive=true by default
                if (!matchedItem) {
                    fulfillment.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        value: false
                    });
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
                if (needInvDetail && serials.length > 0) {

                    var inventoryDetail = fulfillment.getCurrentSublistSubrecord({
                        sublistId: 'item',
                        fieldId: 'inventorydetail'
                    });

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
                }

                fulfillment.commitLine({
                    sublistId: 'item'
                });
            }

            if (!hasValidLine) {
                return {
                    status: 'error',
                    message: 'Tidak ada item valid untuk fulfill'
                };
            }

            // Set Status sebelum di save
            var statusStr = (context.ship_status || context.shipstatus || 'shipped').toLowerCase();
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

            // 🔥 Auto-Approve: set approval status ke 'Approved' sebelum save
            // Kirim "auto_approve": false di payload jika tidak ingin auto-approve
            var shouldAutoApprove = context.auto_approve !== false;
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

    return {
        post: post
    };
});