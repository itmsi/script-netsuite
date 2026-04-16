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
            
            // Delay dinamis: 1.5 detik per item yang di-receive
            var delayTime = itemChecked * 2000;
            var start = new Date().getTime();
            while (new Date().getTime() - start < delayTime) {
                // block thread (sleep)
            }
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

        var grList = [];
        if (poIds.length > 0) {
            try {
                // Kita gabung poIds jadi string untuk klausa IN
                var poIdsPlaceholders = poIds.map(function(){ return '?'; }).join(',');
                
                var sql = "SELECT t.id, t.tranid, t.trandate, tl.createdfrom AS po_id, po.tranid AS po_number " +
                          "FROM transaction t " +
                          "JOIN transactionline tl ON t.id = tl.transaction " +
                          "LEFT JOIN transaction po ON tl.createdfrom = po.id " +
                          "WHERE t.type = 'ItemRcpt' AND tl.createdfrom IN (" + poIdsPlaceholders + ") AND tl.mainline = 'F' " +
                          "ORDER BY t.id DESC";
                
                var grResults = query.runSuiteQL({
                    query: sql,
                    params: poIds
                }).asMappedResults();

                var grMap = {};
                for (var k = 0; k < grResults.length; k++) {
                    var row = grResults[k];
                    
                    // Karena hasil query sudah ORDER BY t.id DESC (terbaru di atas),
                    // kita cukup mengambil data pertama yang muncul untuk setiap PO.
                    if (!grMap[row.po_id]) {
                        grMap[row.po_id] = {
                            id: row.id,
                            tranid: row.tranid,
                            trandate: row.trandate,
                            po_id: row.po_id,
                            po_number: row.po_number || ''
                        };
                    }
                }
                grList = Object.values(grMap);
            } catch (e) {
                log.error('error query GR', e.message);
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
