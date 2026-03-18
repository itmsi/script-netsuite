/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 */
define(['N/record', 'N/log'], function (record, log) {

    function post(context) {

        try {

            const soId = context.sales_order_id;

            if (!soId) {
                return {
                    status: 'error',
                    message: 'sales_order_id is required'
                };
            }

            // =========================
            // 🔥 TRANSFORM SO → FULFILLMENT
            // =========================
            const fulfillment = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: soId,
                toType: record.Type.ITEM_FULFILLMENT,
                isDynamic: true
            });

            const lineCount = fulfillment.getLineCount({
                sublistId: 'item'
            });

            log.debug('LINE COUNT', lineCount);

            let hasValidLine = false;

            // =========================
            // 🔥 LOOP SEMUA LINE
            // =========================
            for (let i = 0; i < lineCount; i++) {

                fulfillment.selectLine({
                    sublistId: 'item',
                    line: i
                });

                const qtyRemaining = fulfillment.getCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantityremaining'
                });

                const itemType = fulfillment.getCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemtype'
                });

                log.debug('CHECK LINE', {
                    i,
                    qtyRemaining,
                    itemType
                });

                // =========================
                // ✅ HANYA PROSES YANG MASIH ADA SISA
                // =========================
                if (qtyRemaining > 0) {

                    hasValidLine = true;

                    // ✅ WAJIB
                    fulfillment.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'itemreceive',
                        value: true
                    });

                    // =========================
                    // 🔥 SERIAL HANDLING
                    // =========================
                    const payloadItem = context.items?.[0] || {};
                    const serials = payloadItem.serials || [];

                    // qty = jumlah serial
                    const qtyToFulfill = serials.length > 0 ? serials.length : 1;

                    fulfillment.setCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        value: qtyToFulfill
                    });

                    const needInvDetail = fulfillment.getCurrentSublistValue({
                        sublistId: 'item',
                        fieldId: 'inventorydetailreq'
                    });

                    log.debug('NEED INV DETAIL', needInvDetail);

                    // =========================
                    // 🔥 INVENTORY DETAIL (SERIAL)
                    // =========================
                    if (needInvDetail && serials.length > 0) {

                        const inventoryDetail = fulfillment.getCurrentSublistSubrecord({
                            sublistId: 'item',
                            fieldId: 'inventorydetail'
                        });

                        serials.forEach((sn) => {

                            inventoryDetail.selectNewLine({
                                sublistId: 'inventoryassignment'
                            });

                            // 🔥 FIX UTAMA (TEXT dulu)
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
                        });
                    }

                    // =========================
                    // ✅ COMMIT LINE
                    // =========================
                    fulfillment.commitLine({
                        sublistId: 'item'
                    });
                }
            }

            // =========================
            // ❌ VALIDASI
            // =========================
            if (!hasValidLine) {
                return {
                    status: 'error',
                    message: 'Tidak ada item valid untuk fulfill'
                };
            }

            // =========================
            // 💾 SAVE
            // =========================
            const fulfillmentId = fulfillment.save();

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