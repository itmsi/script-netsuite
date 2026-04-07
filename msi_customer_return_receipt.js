/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Create Item Receipt for Customer Return Authorization via POST
 *
 * POST body:
 {
   "return_authorization_id": 4971,
   "items": [
     {
       "line"    : 1,
       "quantity": 1,
       "serials" : [855]
     }
   ]
 }
 *
 * Catatan:
 * - line    : nomor baris dari Return Authorization (1-based)
 * - quantity: jumlah yang diterima (opsional jika pakai serials)
 * - serials : array internal ID serial/lot number (opsional)
 */
define(['N/record'], function (record) {

    function post(context) {
        try {

            var raId = context.return_authorization_id;

            if (!raId) {
                return {
                    status : 'error',
                    message: 'return_authorization_id is required'
                };
            }

            // =========================
            // 🔥 TRANSFORM: Return Authorization → Item Receipt
            // =========================
            var itemReceipt = record.transform({
                fromType : record.Type.RETURN_AUTHORIZATION,
                fromId   : raId,
                toType   : record.Type.ITEM_RECEIPT,
                isDynamic: true
            });

            var lineCount = itemReceipt.getLineCount({ sublistId: 'item' });

            var payloadItems = context.items || [];
            var hasValidLine = false;

            // =========================
            // 🔥 LOOP LINE NETSUITE
            // =========================
            for (var i = 0; i < lineCount; i++) {

                itemReceipt.selectLine({ sublistId: 'item', line: i });

                var qtyRemaining = itemReceipt.getCurrentSublistValue({
                    sublistId: 'item',
                    fieldId  : 'quantityremaining'
                });

                var needInvDetail = itemReceipt.getCurrentSublistValue({
                    sublistId: 'item',
                    fieldId  : 'inventorydetailreq'
                });

                if (qtyRemaining <= 0) continue;

                // =========================
                // 🔥 CARI PAYLOAD YANG MATCH (line 1-based)
                // =========================
                var matchedItem = null;
                for (var p = 0; p < payloadItems.length; p++) {
                    if (payloadItems[p].line && (payloadItems[p].line - 1) == i) {
                        matchedItem = payloadItems[p];
                        break;
                    }
                }

                // tidak ada di payload → skip (jangan di-receive)
                if (!matchedItem) continue;

                hasValidLine = true;

                // =========================
                // ✅ TANDAI DITERIMA
                // =========================
                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId  : 'itemreceive',
                    value    : true
                });

                var serials    = matchedItem.serials  || [];
                var payloadQty = matchedItem.quantity || 0;

                var qtyToReceive = 1;
                if (serials.length > 0) {
                    qtyToReceive = serials.length;
                } else if (payloadQty > 0) {
                    qtyToReceive = payloadQty;
                }

                // jangan melebihi remaining
                if (qtyToReceive > qtyRemaining) {
                    qtyToReceive = qtyRemaining;
                }

                itemReceipt.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId  : 'quantity',
                    value    : qtyToReceive
                });

                // =========================
                // 🔥 INVENTORY DETAIL (serial/lot)
                // =========================
                if (needInvDetail && serials.length > 0) {

                    var inventoryDetail = itemReceipt.getCurrentSublistSubrecord({
                        sublistId: 'item',
                        fieldId  : 'inventorydetail'
                    });

                    for (var s = 0; s < serials.length; s++) {
                        inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });

                        try {
                            // coba pakai receiptinventorynumber (untuk Item Receipt)
                            inventoryDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId  : 'receiptinventorynumber',
                                value    : serials[s]
                            });
                        } catch (e1) {
                            try {
                                inventoryDetail.setCurrentSublistText({
                                    sublistId: 'inventoryassignment',
                                    fieldId  : 'receiptinventorynumber',
                                    text     : String(serials[s])
                                });
                            } catch (e2) {
                            }
                        }

                        inventoryDetail.setCurrentSublistValue({
                            sublistId: 'inventoryassignment',
                            fieldId  : 'quantity',
                            value    : 1
                        });

                        inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
                    }
                }

                itemReceipt.commitLine({ sublistId: 'item' });
            }

            if (!hasValidLine) {
                return {
                    status : 'error',
                    message: 'Tidak ada item valid untuk diterima (cek line number atau quantityremaining)'
                };
            }

            var receiptId = itemReceipt.save();

            return {
                status    : 'success',
                receipt_id: receiptId
            };

        } catch (e) {
            return {
                status : 'error',
                message: e.message
            };
        }
    }

    return { post: post };
});
