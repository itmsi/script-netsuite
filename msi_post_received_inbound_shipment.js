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

        // =====================================================================
        // VALIDASI ALL-OR-NOTHING: semua item pending wajib ada di payload
        // Item "pending" = belum fully received (quantityreceived < quantityexpected)
        // =====================================================================
        var pendingLines = [] // baris yang masih perlu di-receive
        for (var p = 0; p < lineCount; p++) {
            var pendingLineId  = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'id', line: p })
            var pendingItem    = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'item', line: p })
            var pendingItemTxt = loadRec.getSublistText({ sublistId: 'receiveitems', fieldId: 'item', line: p })
            var pendingPO      = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'purchaseorder', line: p })
            var pendingPOTxt   = loadRec.getSublistText({ sublistId: 'receiveitems', fieldId: 'purchaseorder', line: p })
            var pendingQtyToRec = parseFloat(loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'quantitytobereceived', line: p })) || 0

            // Hanya masukkan baris yang masih punya qty yang perlu di-receive
            if (pendingQtyToRec > 0) {
                pendingLines.push({
                    line: p,
                    line_id: pendingLineId,
                    item: pendingItem,
                    item_name: pendingItemTxt,
                    po_id: pendingPO,
                    po_number: pendingPOTxt,
                    qty_to_receive: pendingQtyToRec
                })
            }
        }

        // Cek setiap pending line apakah ada di payload
        var missingItems = []
        for (var pm = 0; pm < pendingLines.length; pm++) {
            var pendLine = pendingLines[pm]
            var foundInPayload = false

            for (var px = 0; px < params.items.length; px++) {
                var payItem = params.items[px]
                var match = true

                // Jika payload punya line_id, cocokkan
                if (payItem.line_id && payItem.line_id != pendLine.line_id) match = false
                // Jika payload punya item, cocokkan
                if (payItem.item && payItem.item != pendLine.item) match = false
                // Jika payload punya po_id, cocokkan
                if (payItem.po_id && payItem.po_id != pendLine.po_id) match = false

                // Jika tidak ada satupun kriteria spesifik yang dikirim, anggap tidak cocok
                if (!payItem.line_id && !payItem.item && !payItem.po_id) match = false

                if (match) {
                    foundInPayload = true
                    break
                }
            }

            if (!foundInPayload) {
                missingItems.push('line_id=' + pendLine.line_id + ' | item=' + pendLine.item_name + ' | PO=' + pendLine.po_number + ' | qty_to_receive=' + pendLine.qty_to_receive)
            }
        }

        if (missingItems.length > 0) {
            throw new Error(
                'Partial inbound tidak diizinkan. Semua item harus di-inbound sekaligus. ' +
                'Item berikut belum ada (' + missingItems.length + ' item): ' +
                missingItems.join(' | ')
            )
        }
        // =====================================================================

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

        // Ambil po_id dari payload untuk pencarian GR
        var payloadPoIds = [];
        params.items.forEach(function (item) {
            if (item.po_id && payloadPoIds.indexOf(item.po_id) === -1) payloadPoIds.push(item.po_id);
        });

        // Cari Item Receipt via po_id lalu cek inboundshipment di header record IR
        var grList = [];
        if (payloadPoIds.length > 0) {
            try {
                var irSearch = search.create({
                    type: search.Type.TRANSACTION,
                    filters: [
                        ['type', 'anyof', 'ItemRcpt'],
                        'AND',
                        ['createdfrom', 'anyof', payloadPoIds],
                        'AND',
                        ['mainline', 'is', 'T']
                    ],
                    columns: ['tranid', 'trandate', 'createdfrom']
                });

                var candidateIrs = [];
                irSearch.run().each(function (result) {
                    candidateIrs.push({
                        id: result.id,
                        tranid: result.getValue({ name: 'tranid' }),
                        trandate: result.getValue({ name: 'trandate' }),
                        po_id: result.getValue({ name: 'createdfrom' }),
                        po_number: result.getText({ name: 'createdfrom' })
                    });
                    return true;
                });

                for (var i = 0; i < candidateIrs.length; i++) {
                    var cand = candidateIrs[i];
                    try {
                        var recIr = record.load({ type: 'itemreceipt', id: cand.id });
                        var inbId = recIr.getValue({ fieldId: 'inboundshipment' });
                        
                        // Periksa apakah Item Receipt ini milik Inbound Shipment yang sedang diproses
                        if (String(inbId) === String(params.idInboundShipment)) {
                            var itemsArr = [];
                            var lines = recIr.getLineCount({ sublistId: 'item' });
                            for (var j = 0; j < lines; j++) {
                                itemsArr.push({
                                    item_id: recIr.getSublistValue({ sublistId: 'item', fieldId: 'item', line: j }),
                                    item_name: recIr.getSublistText({ sublistId: 'item', fieldId: 'item', line: j })
                                });
                            }
                            
                            grList.push({
                                id: cand.id,
                                tranid: cand.tranid,
                                trandate: cand.trandate,
                                po_id: cand.po_id,
                                po_number: cand.po_number,
                                items: itemsArr
                            });
                        }
                    } catch (eLoad) {
                        log.error('error load IR ' + cand.id, eLoad.message);
                    }
                }
            } catch (e) {
                log.error('error search candidate IRs', e.message);
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
