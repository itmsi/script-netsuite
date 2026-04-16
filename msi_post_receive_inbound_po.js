/**
 *@NApiVersion 2.1
 *@NScriptType Restlet
 */
define(['N/record', 'N/query', 'N/search'], function (record, query, search) {

    function receiptInbound(params) {

        var loadRec = record.load({
            type: 'receiveinboundshipment', // type record
            id: params.idInboundShipment // internalid inbound shipment
        })

        // uncheck semua item dulu — karena NetSuite auto-centang semua saat load
        var lineCount = loadRec.getLineCount({ sublistId: 'receiveitems' })
        for (var i = 0; i < lineCount; i++) {
            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'receiveitem',
                line: i,
                value: false
            })
        }

        // loop item dari payload
        var itemChecked = 0;
        
        // Simpan index line yang sudah diproses
        var processedLines = {};

        for (var x = 0; x < params.items.length; x++) {
            var itemData = params.items[x];

            var lineNumber = -1;
            
            // Manual search for matching line by Item and (optional) PO ID
            // We use lineCount which was defined when unchecking all items above
            for (var j = 0; j < lineCount; j++) {
                var lineItem = loadRec.getSublistValue({
                    sublistId: 'receiveitems',
                    fieldId: 'item',
                    line: j
                });
                
                var linePO = loadRec.getSublistValue({
                    sublistId: 'receiveitems',
                    fieldId: 'purchaseorder',
                    line: j
                });

                // Cocokkan item, dan jika payload punya po_id, cocokkan juga PO-nya
                if (lineItem == itemData.item && !processedLines[j]) {
                    if (!itemData.po_id || linePO == itemData.po_id) {
                        lineNumber = j;
                        processedLines[j] = true;
                        break;
                    }
                }
            }

            if (lineNumber === -1) {
                continue
            }

            // centang receive
            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'receiveitem',
                line: lineNumber,
                value: true
            })

            // qty dari payload, kalau tidak ada pakai quantityremaining (full receive)
            var currentRemainingQty = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'quantityremaining', line: lineNumber });
            if (!currentRemainingQty) {
                currentRemainingQty = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'quantityexpected', line: lineNumber }) || 1;
            }
            var qty = itemData.quantity !== undefined ? itemData.quantity : currentRemainingQty;

            // set field quantitytobereceived (Ini adalah field yang diedit saat form Receive di UI)
            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'quantitytobereceived',
                line: lineNumber,
                value: qty
            });
            
            itemChecked++;
        }

        // kalau tidak ada item yang valid, skip save — langsung query existing GRs
        var savedId = params.idInboundShipment
        if (itemChecked > 0) {
            savedId = loadRec.save()
        }

        // ambil status inbound shipment terbaru dari DB
        var shipmentInfo = query.runSuiteQL({
            query: 'SELECT shipmentstatus FROM InboundShipment WHERE id = ?',
            params: [params.idInboundShipment]
        }).asMappedResults()
        var shipmentStatus = shipmentInfo.length > 0 ? shipmentInfo[0].shipmentstatus : null

        // step 1: ambil PO IDs dari InboundShipmentItem
        var poResults = query.runSuiteQL({
            query: 'SELECT DISTINCT purchaseordertransaction AS po_id FROM InboundShipmentItem WHERE inboundshipment = ?',
            params: [params.idInboundShipment]
        }).asMappedResults()

        var poIds = poResults.map(function(r) { return r.po_id })

        // cari Item Receipt dari PO yang linked ke inbound shipment ini
        // N/search pakai createdfrom filter — reliable untuk GR yang sudah ada
        // (delay indexing hanya terjadi untuk GR yang baru dibuat di request yang sama)
        var grList = []
        if (poIds.length > 0) {
            try {
                var grMap = {}
                search.create({
                    type: 'itemreceipt',
                    filters: [
                        ['createdfrom', 'anyof', poIds]
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'tranid' }),
                        search.createColumn({ name: 'trandate' }),
                        search.createColumn({ name: 'createdfrom' })
                    ]
                }).run().each(function(result) {
                    if (!grMap[result.id]) {
                        grMap[result.id] = {
                            id: result.id,
                            tranid: result.getValue('tranid'),
                            trandate: result.getValue('trandate'),
                            po_id: result.getValue('createdfrom'),
                            po_number: result.getText('createdfrom')
                        }
                    }
                    return true
                })
                grList = Object.values(grMap)
            } catch (e) {
                log.error('error search GR', e.message)
            }
        }

        return {
            inboundShipmentId: savedId,
            inboundShipmentStatus: shipmentStatus,
            goodsReceipts: grList
        }
    }

    function post(params) {
        try {
            var result = receiptInbound(params)
            return {
                success: true,
                inbound_shipment_id: result.inboundShipmentId,
                inbound_shipment_status: result.inboundShipmentStatus,
                goods_receipts: result.goodsReceipts
            }
        } catch (e) {
            return {
                success: false,
                message: e.message
            }
        }
    }

    return {
        post: post
    }
});
