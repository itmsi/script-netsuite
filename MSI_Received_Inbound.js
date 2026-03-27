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
 Unique Key = uniquekey
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
        for (var x = 0; x < params.items.length; x++) {
            var itemData = params.items[x]

            var lineNumber = loadRec.findSublistLineWithValue({
                sublistId: 'receiveitems',
                fieldId: 'item',
                value: itemData.item
            })
            log.debug('item ' + itemData.item + ' lineNumber', lineNumber)

            if (lineNumber === -1) {
                log.debug('item not found', itemData.item)
                continue
            }

            // centang receive
            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'receiveitem',
                line: lineNumber,
                value: true
            })

            // qty dari payload, kalau tidak ada pakai quantitytobereceived (full receive)
            var qty = itemData.quantity !== undefined
                ? itemData.quantity
                : loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'quantitytobereceived', line: lineNumber })

            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'quantity',
                line: lineNumber,
                value: qty
            })
            log.debug('set qty item ' + itemData.item, qty)
        }

        var savedId = loadRec.save()

        // ambil status inbound shipment terbaru dari DB
        var shipmentInfo = query.runSuiteQL({
            query: 'SELECT shipmentstatus FROM InboundShipment WHERE id = ?',
            params: [params.idInboundShipment]
        }).asMappedResults()
        var shipmentStatus = shipmentInfo.length > 0 ? shipmentInfo[0].shipmentstatus : null
        log.debug('inbound shipment status', shipmentStatus)

        // step 1: ambil PO IDs dari InboundShipmentItem
        var poResults = query.runSuiteQL({
            query: 'SELECT DISTINCT purchaseordertransaction AS po_id FROM InboundShipmentItem WHERE inboundshipment = ?',
            params: [params.idInboundShipment]
        }).asMappedResults()

        var poIds = poResults.map(function(r) { return r.po_id })
        log.debug('PO IDs', JSON.stringify(poIds))

        // cari Item Receipt dari PO yang linked ke inbound shipment ini
        // N/search pakai createdfrom filter — reliable untuk GR yang sudah ada
        // (delay indexing hanya terjadi untuk GR yang baru dibuat di request yang sama)
        var grList = []
        if (poIds.length > 0) {
            try {
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
                    grList.push({
                        id: result.id,
                        tranid: result.getValue('tranid'),
                        trandate: result.getValue('trandate'),
                        po_id: result.getValue('createdfrom'),
                        po_number: result.getText('createdfrom')
                    })
                    return true
                })
            } catch (e) {
                log.error('error search GR', e.message)
            }
        }

        log.debug('GR list', JSON.stringify(grList))

        return {
            inboundShipmentId: savedId,
            inboundShipmentStatus: shipmentStatus,
            goodsReceipts: grList
        }
    }

    function post(params) {
        try {
            var result = receiptInbound(params)
            log.debug('create receipt', JSON.stringify(result))
            return {
                success: true,
                inbound_shipment_id: result.inboundShipmentId,
                inbound_shipment_status: result.inboundShipmentStatus,
                goods_receipts: result.goodsReceipts
            }
        } catch (e) {
            log.error('error receiptInbound', e)
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
