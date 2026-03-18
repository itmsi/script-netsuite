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

            var lineCount = fulfillment.getLineCount({
                sublistId: 'item'
            });

            log.debug('LINE COUNT', lineCount);

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

                log.debug('CHECK LINE', {
                    line: i,
                    qtyRemaining: qtyRemaining,
                    needInvDetail: needInvDetail
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

                // =========================
                // 🔥 INVENTORY DETAIL
                // =========================
                if (needInvDetail && serials.length > 0) {

                    var inventoryDetail = fulfillment.getCurrentSublistSubrecord({
                        sublistId: 'item',
                        fieldId: 'inventorydetail'
                    });

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

            var shipStatusMap = {
                picked: 'A',
                packed: 'B',
                shipped: 'C'
                };

                var status = context.ship_status || 'shipped';

                fulfillment.setValue({
                    fieldId: 'shipstatus',
                    value: shipStatusMap[status] || 'C'
                });

            var fulfillmentId = fulfillment.save();

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