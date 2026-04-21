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

        /* inserting body sample

        {
        "idInboundShipment": 37,
        "items": [
            {
            "line_id": 64,     // Internal ID of InboundShipmentItem
            "item": 22253,       // Item Internal ID
            "po_id": 12387      // PO Internal ID
            }
        ]
        }
        
            loadRec.setValue('trandate',valueDate)
            trandate = field id
            valueDate = date value

        standard avaiable field id

        Date = trandate
        Posting Period = postingperiod
        Vendor = vendor
        Incoterm = incoterm
        Receiving Location = receivinglocation
        External ID = externalid

        standatd avaiable line id

        Receive = receiveitem
 PO = purchaseorder
 Item = item
 Description = description
 Vendor = vendor
 Receiving Location = receivinglocation
 Quantity Received = quantityreceived
 Quantity = quantity
 Quantity to be Received = quantitytobereceived
 Unit = unit
 Inventory Detail = inventorydetail
 PO Rate = porate
 Rate = rate
 Amount = amount
 Currency = currency
 Incoterm = incoterm
 Ownership Transfer = ownershiptransfer
 Unique Key = id
 Item Source = origline
 Exchange Rate = exchangerate
 Quantity Remaining = quantityremaining
 Currency Precision = currencyprecision
 Unit of Measure = unitid
        */

        /*
            inserting line sample

            
        

            


        */




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
        var itemChecked = 0

        for (var x = 0; x < params.items.length; x++) {
            var itemData = params.items[x]
            var foundLine = -1

            for (var i = 0; i < lineCount; i++) {
                // ambil data dari sublist untuk pencocokan
                var sublistLineId = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'id', line: i })
                var sublistItem = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'item', line: i })
                var sublistPO = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'purchaseorder', line: i })
                var isChecked = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'receiveitem', line: i })

                // skip kalau baris ini sudah tercentang oleh item sebelumnya di payload
                if (isChecked) continue

                // Cocokkan semua kriteria yang dikirim di payload (Composite Matching)
                var isMatch = true
                
                // Jika line_id dikirim, wajib cocok dengan field id sublist
                if (itemData.line_id && itemData.line_id != sublistLineId) isMatch = false
                
                // Jika item dikirim, wajib cocok
                if (itemData.item && itemData.item != sublistItem) isMatch = false
                
                // Jika po_id dikirim, wajib cocok
                if (itemData.po_id && itemData.po_id != sublistPO) isMatch = false

                // Jika semua kriteria yang ada cocok, ambil baris ini
                if (isMatch) {
                    foundLine = i
                    break
                }
            }

            if (foundLine === -1) {
                continue
            }

            // centang receive
            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'receiveitem',
                line: foundLine,
                value: true
            })

            // qty dari payload, kalau tidak ada pakai quantitytobereceived (full receive)
            var qty = itemData.quantity !== undefined
                ? itemData.quantity
                : loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'quantitytobereceived', line: foundLine })

            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'quantity',
                line: foundLine,
                value: qty
            })
            itemChecked++
        }

        // kalau tidak ada item yang valid, skip save — langsung query existing GRs
        var savedId = params.idInboundShipment

        if (itemChecked > 0) {
            try {
                savedId = loadRec.save()
            } catch (saveError) {
                throw saveError
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
                        ['createdfrom', 'anyof', poIds],
                        'AND',
                        ['item', 'anyof', params.items.map(function(item) { return item.item })]
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
