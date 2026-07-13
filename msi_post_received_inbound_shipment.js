/**
 *@NApiVersion 2.1
 *@NScriptType Restlet
 */
define(['N/record', 'N/search'], function (record, search) {

    function receiptInbound(params) {

        var loadRec = record.load({
            type: 'receiveinboundshipment',
            id: params.idInboundShipment
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
        // dan CACHE semua data line agar tidak terbebani getSublistValue di dalam loop 1100 item
        var lineCount = loadRec.getLineCount({ sublistId: 'receiveitems' })
        var receiveItemsData = []
        var pendingLines = []

        for (var i = 0; i < lineCount; i++) {
            loadRec.setSublistValue({
                sublistId: 'receiveitems',
                fieldId: 'receiveitem',
                line: i,
                value: false
            })

            var lineId = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'id', line: i })
            var item = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'item', line: i })
            var itemTxt = loadRec.getSublistText({ sublistId: 'receiveitems', fieldId: 'item', line: i })
            var po = loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'purchaseorder', line: i })
            var poTxt = loadRec.getSublistText({ sublistId: 'receiveitems', fieldId: 'purchaseorder', line: i })
            var qtyToRec = parseFloat(loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'quantitytobereceived', line: i })) || 0

            receiveItemsData.push({
                line: i,
                id: lineId,
                item: item,
                po: po,
                isChecked: false
            })

            if (qtyToRec > 0) {
                pendingLines.push({
                    line: i,
                    line_id: lineId,
                    item: item,
                    item_name: itemTxt,
                    po_id: po,
                    po_number: poTxt,
                    qty_to_receive: qtyToRec
                })
            }
        }

        if (params.isCheck === undefined || params.isCheck === null) {
            throw new Error('isCheck is required. Use 0 to process and save, or 1 to check only.')
        }

        var isCheck = Number(params.isCheck)

        if (isCheck === 0) {
            var missingItems = []
            for (var pm = 0; pm < pendingLines.length; pm++) {
                var pendLine = pendingLines[pm]
                var foundInPayload = false

                for (var px = 0; px < params.items.length; px++) {
                    var payItem = params.items[px]
                    var match = true

                    if (payItem.line_id && String(payItem.line_id) !== String(pendLine.line_id)) match = false
                    if (payItem.item && String(payItem.item) !== String(pendLine.item)) match = false
                    if (payItem.po_id && String(payItem.po_id) !== String(pendLine.po_id)) match = false

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
        }

        // OPTIMASI: Menggunakan search standard NetSuite sebagai pengganti SuiteQL
        // Search Inbound Shipment untuk mendapatkan semua baris item (termasuk yang fully received)
        var allItemsResult = [];
        var shipmentStatus = null;

        // Ambil shipment status via search — column 'status' tersedia di inboundshipment search
        try {
            var statusSearch = search.create({
                type: 'inboundshipment',
                filters: [['internalid', 'anyof', params.idInboundShipment]],
                columns: ['status']
            });
            statusSearch.run().each(function (result) {
                shipmentStatus = result.getValue('status') || result.getText('status');
                return false;
            });
        } catch (e) {
            log.error('Error getting shipment status', e.message);
        }

        // Pastikan tidak undefined agar tidak hilang dari JSON response
        if (shipmentStatus === undefined) shipmentStatus = null;

        try {
            var shipmentSearch = search.create({
                type: 'inboundshipment',
                filters: [['internalid', 'anyof', params.idInboundShipment]],
                columns: [
                    'item',
                    'purchaseorder',
                    'quantityexpected',
                    'quantityreceived'
                ]
            });

            shipmentSearch.run().each(function (result) {
                allItemsResult.push({
                    id: null, // Kita ignore ID dan fallback ke pencocokan PO + Item karena standard search tidak expose line_id dengan baik
                    purchaseordertransaction: result.getValue('purchaseorder'),
                    item: result.getValue('item'),
                    quantityexpected: result.getValue('quantityexpected'),
                    quantityreceived: result.getValue('quantityreceived')
                });
                return true;
            });
        } catch (e) {
            log.error('Error search inbound shipment', e.message);
        }

        var itemChecked = 0

        if (isCheck === 0) {
            for (var x = 0; x < params.items.length; x++) {
                var itemData = params.items[x]
                var foundLine = -1

                for (var i = 0; i < receiveItemsData.length; i++) {
                    var sublistData = receiveItemsData[i]

                    if (sublistData.isChecked) continue

                    var isMatch = true

                    if (itemData.line_id && String(itemData.line_id) !== String(sublistData.id)) isMatch = false
                    if (itemData.item && String(itemData.item) !== String(sublistData.item)) isMatch = false
                    if (itemData.po_id && String(itemData.po_id) !== String(sublistData.po)) isMatch = false

                    if (isMatch) {
                        foundLine = sublistData.line
                        sublistData.isChecked = true
                        break
                    }
                }

                if (foundLine === -1) {
                    var matchedInDb = null;
                    for (var dbIdx = 0; dbIdx < allItemsResult.length; dbIdx++) {
                        var row = allItemsResult[dbIdx];
                        var dbMatch = true;

                        if (itemData.line_id && row.id && String(itemData.line_id) !== String(row.id)) dbMatch = false;
                        if (itemData.po_id && row.purchaseordertransaction && String(itemData.po_id) !== String(row.purchaseordertransaction)) dbMatch = false;
                        if (itemData.item && row.item && String(itemData.item) !== String(row.item)) dbMatch = false;

                        if (dbMatch) {
                            matchedInDb = row;
                            break;
                        }
                    }

                    if (!matchedInDb) {
                        throw new Error('Item validation failed: Data (line_id: ' + (itemData.line_id || '-') + ', item: ' + (itemData.item || '-') + ', po_id: ' + (itemData.po_id || '-') + ') tidak ditemukan pada Inbound Shipment ini.');
                    } else {
                        var qtyExp = parseFloat(matchedInDb.quantityexpected) || 0;
                        var qtyRec = parseFloat(matchedInDb.quantityreceived) || 0;

                        if (qtyRec >= qtyExp) {
                            continue;
                        } else {
                            throw new Error('Item (line_id: ' + (itemData.line_id || '-') + ') belum sepenuhnya terinbound tetapi tidak tersedia untuk di-receive pada saat load form. Silakan periksa status dokumen.');
                        }
                    }
                }

                loadRec.setSublistValue({
                    sublistId: 'receiveitems',
                    fieldId: 'receiveitem',
                    line: foundLine,
                    value: true
                })

                var qty = itemData.quantity !== undefined
                    ? itemData.quantity
                    : loadRec.getSublistValue({ sublistId: 'receiveitems', fieldId: 'quantitytobereceived', line: foundLine })

                loadRec.setSublistValue({
                    sublistId: 'receiveitems',
                    fieldId: 'quantity',
                    line: foundLine,
                    value: qty
                })

                if (itemData.inventory_detail && Array.isArray(itemData.inventory_detail)) {
                    var subrec = loadRec.getSublistSubrecord({
                        sublistId: 'receiveitems',
                        fieldId: 'inventorydetail',
                        line: foundLine
                    });

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
        }

        var savedId = params.idInboundShipment
        var isProcess = null

        var grList = [];
        try {
            // Cari Item Receipt yang terkait — filter createdfrom pakai PO ID dari item
            var payloadPoIds = [];
            for (var pi = 0; pi < params.items.length; pi++) {
                var pid = params.items[pi].po_id;
                if (pid && payloadPoIds.indexOf(pid) === -1) payloadPoIds.push(pid);
            }

            var irHeaderSearch = search.create({
                type: search.Type.TRANSACTION,
                filters: [
                    ['type', 'anyof', 'ItemRcpt'],
                    'AND',
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['createdfrom', 'anyof', payloadPoIds]
                ],
                columns: ['tranid', 'trandate', 'createdfrom']
            });

            var irIds = [];
            var irHeaders = [];
            irHeaderSearch.run().each(function (result) {
                irIds.push(result.id);
                irHeaders.push({
                    id: result.id,
                    tranid: result.getValue({ name: 'tranid' }),
                    trandate: result.getValue({ name: 'trandate' }),
                    po_id: result.getValue({ name: 'createdfrom' }),
                    po_number: result.getText({ name: 'createdfrom' })
                });
                return true;
            });

            // Tahap 2: Cari line items untuk IR yang ditemukan
            if (irIds.length > 0) {
                var irLineSearch = search.create({
                    type: search.Type.TRANSACTION,
                    filters: [
                        ['type', 'anyof', 'ItemRcpt'],
                        'AND',
                        ['internalid', 'anyof', irIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F'],
                        'AND',
                        ['shipping', 'is', 'F'],
                        'AND',
                        ['cogs', 'is', 'F']
                    ],
                    columns: ['item']
                });

                var lineMap = {};
                irLineSearch.run().each(function (result) {
                    var irId = result.id;
                    if (!lineMap[irId]) {
                        lineMap[irId] = [];
                    }
                    lineMap[irId].push({
                        item_id: result.getValue({ name: 'item' }),
                        item_name: result.getText({ name: 'item' })
                    });
                    return true;
                });

                for (var h = 0; h < irHeaders.length; h++) {
                    var header = irHeaders[h];
                    grList.push({
                        id: header.id,
                        tranid: header.tranid,
                        trandate: header.trandate,
                        po_id: header.po_id,
                        po_number: header.po_number,
                        items: lineMap[header.id] || []
                    });
                }
            }
        } catch (e) {
            log.error('error search candidate IRs', e.message);
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
