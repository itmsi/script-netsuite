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
            "po_id": 12387,      // PO Internal ID
            "quantity": 1,       // Optional quantity
            "inventory_detail": [ // Optional: Required for Serialized/Lot items
                { "inventory_number": "SN-001", "quantity": 1 }
            ]
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
                // Validasi: Cek apakah item benar-benar ada di Inbound Shipment ini
                var conditions = ['isi.inboundshipment = ' + params.idInboundShipment];
                if (itemData.line_id) conditions.push('isi.id = ' + itemData.line_id);
                if (itemData.po_id) conditions.push('isi.purchaseordertransaction = ' + itemData.po_id);
                if (itemData.item) conditions.push('tl.item = ' + itemData.item);

                var checkSql = 'SELECT isi.quantityexpected, isi.quantityreceived ' + 
                               'FROM InboundShipmentItem isi ' +
                               'LEFT JOIN TransactionLine tl ON tl.uniquekey = isi.shipmentitemtransaction ' +
                               'WHERE ' + conditions.join(' AND ');
                var checkResults = query.runSuiteQL({ query: checkSql }).asMappedResults();

                if (checkResults.length === 0) {
                    throw new Error('Item validation failed: Data (line_id: ' + (itemData.line_id || '-') + ', item: ' + (itemData.item || '-') + ', po_id: ' + (itemData.po_id || '-') + ') tidak ditemukan pada Inbound Shipment ini.');
                } else {
                    var qtyExp = parseFloat(checkResults[0].quantityexpected) || 0;
                    var qtyRec = parseFloat(checkResults[0].quantityreceived) || 0;
                    
                    if (qtyRec >= qtyExp) {
                        // Sudah habis terinbound (fully received), jangan digagalkan
                        continue;
                    } else {
                        // Belum fully received tapi tidak muncul di list receiveitems? Gagalkan.
                        throw new Error('Item (line_id: ' + (itemData.line_id || '-') + ') belum sepenuhnya terinbound tetapi tidak tersedia untuk di-receive pada saat load form. Silakan periksa status dokumen.');
                    }
                }
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

            // Set Inventory Detail jika ada (untuk Serial/Lot items)
            if (itemData.inventory_detail && Array.isArray(itemData.inventory_detail)) {
                var subrec = loadRec.getSublistSubrecord({
                    sublistId: 'receiveitems',
                    fieldId: 'inventorydetail',
                    line: foundLine
                });

                // Hapus baris existing jika ada (biasanya kosong saat load, tapi untuk jaga-jaga)
                var existingInvLines = subrec.getLineCount({ sublistId: 'inventoryassignment' });
                for (var j = existingInvLines - 1; j >= 0; j--) {
                    subrec.removeLine({ sublistId: 'inventoryassignment', line: j });
                }

                for (var k = 0; k < itemData.inventory_detail.length; k++) {
                    var invData = itemData.inventory_detail[k];
                    subrec.setSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'receiptinventorynumber',
                        line: k,
                        value: invData.inventory_number || invData.receiptinventorynumber
                    });
                    subrec.setSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'quantity',
                        line: k,
                        value: invData.quantity
                    });
                    if (invData.binnumber) {
                        subrec.setSublistValue({
                            sublistId: 'inventoryassignment',
                            fieldId: 'binnumber',
                            line: k,
                            value: invData.binnumber
                        });
                    }
                }
            }

            itemChecked++
        }

        // kalau tidak ada item yang valid, skip save — langsung query existing GRs
        var savedId = params.idInboundShipment
        var isProcess = null

        // isCheck wajib dikirim di payload
        if (params.isCheck === undefined || params.isCheck === null) {
            throw new Error('isCheck is required. Use 0 to process and save, or 1 to check only.')
        }

        var isCheck = Number(params.isCheck)

        // ambil status inbound shipment terbaru dari DB (diperlukan sebelum keputusan save)
        var shipmentInfo = query.runSuiteQL({
            query: 'SELECT shipmentstatus FROM InboundShipment WHERE id = ?',
            params: [params.idInboundShipment]
        }).asMappedResults()
        var shipmentStatus = shipmentInfo.length > 0 ? shipmentInfo[0].shipmentstatus : null

        // Ambil po_id dan item hanya dari payload yang dikirim (unique values)
        var payloadPoIds = [];
        var payloadItemIds = [];
        
        params.items.forEach(function(item) {
            if (item.po_id && payloadPoIds.indexOf(item.po_id) === -1) payloadPoIds.push(item.po_id);
            if (item.item && payloadItemIds.indexOf(item.item) === -1) payloadItemIds.push(item.item);
        });

        // Cari Item Receipt hanya dari PO dan item yang ada di payload via SuiteQL
        var grList = [];
        if (payloadPoIds.length > 0 && payloadItemIds.length > 0) {
            try {
                let sql = `
                    SELECT DISTINCT
                        t.id,
                        t.tranid,
                        t.trandate,
                        tl.createdfrom as po_id,
                        BUILTIN.DF(tl.createdfrom) as po_number,
                        tl.item as item_id,
                        BUILTIN.DF(tl.item) as item_name
                    FROM
                        Transaction t
                    JOIN
                        TransactionLine tl ON t.id = tl.transaction
                    JOIN
                        InboundShipmentItem isi ON tl.createdfrom = isi.purchaseordertransaction
                    JOIN
                        TransactionLine tl_po ON tl_po.uniquekey = isi.shipmentitemtransaction
                    WHERE
                        t.type = 'ItemRcpt'
                        AND tl_po.item = tl.item
                        AND isi.inboundshipment = ${params.idInboundShipment}
                        AND tl.item IN (${payloadItemIds.join(',')})
                        AND tl.createdfrom IN (${payloadPoIds.join(',')})
                `;

                var queryResults = query.runSuiteQL({ query: sql }).asMappedResults();

                var grMap = {};
                queryResults.forEach(function(r) {
                    if (!grMap[r.id]) {
                        grMap[r.id] = {
                            id: r.id,
                            tranid: r.tranid,
                            trandate: r.trandate,
                            po_id: r.po_id,
                            po_number: r.po_number,
                            items: []
                        };
                    }
                    grMap[r.id].items.push({
                        item_id: r.item_id,
                        item_name: r.item_name
                    });
                });

                for (var key in grMap) {
                    grList.push(grMap[key]);
                }
            } catch (e) {
                log.error('error search GR via SuiteQL', e.message);
            }
        }
        
        if (isCheck === 0) {
            if (itemChecked > 0) {
                try {
                    savedId = loadRec.save()
                    isProcess = 'process'
                } catch (saveError) {
                    throw saveError
                }
            } else if (shipmentStatus === 'received') {
                isProcess = 'success'
            }
        } else if (isCheck === 1) {
            if (grList.length > 0) {
                isProcess = 'success'
            } else {
                isProcess = 'process'
            }
        }

        return {
            inboundShipmentId: savedId,
            inboundShipmentStatus: shipmentStatus,
            goodsReceipts: grList,
            isProcess: isProcess
        }
    }

    function post(params) {
        try {
            var result = receiptInbound(params)
            var response = {
                success: true,
                inbound_shipment_id: result.inboundShipmentId,
                inbound_shipment_status: result.inboundShipmentStatus,
                goods_receipts: result.goodsReceipts
            }
            if (result.isProcess !== null) {
                response.isProcess = result.isProcess
            }
            return response
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
