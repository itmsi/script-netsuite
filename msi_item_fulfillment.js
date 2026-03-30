/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 */
define(['N/record', 'N/log'], function (record, log) {

    function post(context) {

        try {

            var soId = context.sales_order_id;

            if (!soId) {
                return {
                    status: 'error',
                    message: 'sales_order_id is required'
                };
            }

            var fulfillment = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: soId,
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
                if (!matchedItem) {
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

                var qtyToFulfill = 1;

                if (serials && serials.length > 0) {
                    qtyToFulfill = serials.length;
                } else if (payloadQty && payloadQty > 0) {
                    qtyToFulfill = payloadQty;
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
            var shipStatusMap = {
                picked: 'A',
                packed: 'B',
                shipped: 'C'
            };
            var statusStr = context.ship_status || 'shipped';
            var statusCode = shipStatusMap[statusStr.toLowerCase()] || 'C';

            try {
                fulfillment.setValue({
                    fieldId: 'shipstatus',
                    value: statusCode
                });
            } catch (e) {
                // fallbacks if standard value fail
                fulfillment.setText({
                    fieldId: 'shipstatus',
                    text: 'Shipped' // try text mapping if value fails
                });
            }

            var fulfillmentId = fulfillment.save({
                enableSourcing: true,
                ignoreMandatoryFields: true // Bypass UI validation errors for standard fields mapped dynamically
            });

            return {
                status: 'success',
                fulfillment_id: fulfillmentId
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