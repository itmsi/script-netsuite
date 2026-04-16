/**
 *@NApiVersion 2.1
 *@NScriptType Restlet
 */

 /*
 Body request
{
  "po_id": 7228, 
  "items": [
    {
      "item": 19593,
      "quantity": 1
    }
  ]
}
 */
define(['N/record', 'N/search'], function (record, search) {

    function receiptPurchaseOrder(params) {
        if (!params.po_id) {
            throw new Error("Parameter 'po_id' (Purchase Order Internal ID) wajib dikirim");
        }

        // Transform PO menjadi Item Receipt secara langsung
        var loadRec = record.transform({
            fromType: record.Type.PURCHASE_ORDER,
            fromId: params.po_id,
            toType: record.Type.ITEM_RECEIPT,
            isDynamic: false 
        });

        // uncheck semua item dulu — karena NetSuite auto-centang semua saat transform
        var lineCount = loadRec.getLineCount({ sublistId: 'item' });
        for (var i = 0; i < lineCount; i++) {
            loadRec.setSublistValue({
                sublistId: 'item',
                fieldId: 'itemreceive',
                line: i,
                value: false
            });
        }

        // loop item dari payload
        var itemChecked = 0;
        var processedLines = {}; // Mencegah line yang sama di-receive 2 kali

        for (var x = 0; x < params.items.length; x++) {
            var itemData = params.items[x];
            var lineNumber = -1;
            
            // Cari line yang item-nya cocok secara manual
            for (var j = 0; j < lineCount; j++) {
                var lineItem = loadRec.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: j
                });

                if (lineItem == itemData.item && !processedLines[j]) {
                    lineNumber = j;
                    processedLines[j] = true;
                    break;
                }
            }

            if (lineNumber === -1) {
                continue; // Item tidak ditemukan di PO ini atau sudah terproses
            }

            // centang receive
            loadRec.setSublistValue({
                sublistId: 'item',
                fieldId: 'itemreceive',
                line: lineNumber,
                value: true
            });

            // Tentukan quantity. Default-nya ambil sisa qty yang belum di-receive (quantityremaining)
            var currentRemainingQty = loadRec.getSublistValue({ sublistId: 'item', fieldId: 'quantityremaining', line: lineNumber }) || 1;
            var qty = itemData.quantity !== undefined ? itemData.quantity : currentRemainingQty;

            loadRec.setSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: lineNumber,
                value: qty
            });
            
            // Catatan: Jika location dibutuhkan, bisa ditambahkan di sini
            if (itemData.location) {
                loadRec.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'location',
                    line: lineNumber,
                    value: itemData.location
                });
            }
            
            itemChecked++;
        }

        if (itemChecked === 0) {
            var availableItems = [];
            for (var i = 0; i < lineCount; i++) {
                availableItems.push(loadRec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            }
            var payloadItems = params.items.map(function(itm) { return itm.item; });
            throw new Error("Tidak ada item valid. lineCount di IR: " + lineCount + 
                            ", Available Items: " + JSON.stringify(availableItems) + 
                            ", Payload Items: " + JSON.stringify(payloadItems));
        }

        // fungsi save() mengembalikan internal ID Item Receipt-nya!
        var irId = loadRec.save();
        
        var grList = [];

        // Ambil nomor resi (tranid) dan trandate dari DB menggunakan N/search
        try {
            var irFields = search.lookupFields({
                type: search.Type.ITEM_RECEIPT,
                id: irId,
                columns: ['tranid', 'trandate']
            });
            var receiptNumber = irFields.tranid || '';
            var receiptDate = irFields.trandate || '';

            // Ambil nomor PO untuk melengkapi response
            var poFields = search.lookupFields({
                type: search.Type.PURCHASE_ORDER,
                id: params.po_id,
                columns: ['tranid']
            });
            
            if (Array.isArray(poFields.tranid)) {
                var poNumber = poFields.tranid.length > 0 ? poFields.tranid[0].text : '';
            } else {
                var poNumber = poFields.tranid || '';
            }

            grList.push({
                id: irId,
                tranid: receiptNumber,
                trandate: receiptDate,
                po_id: params.po_id,
                po_number: poNumber
            });
        } catch (e) {
            log.error('error tarik info GR', e.message);
        }

        return {
            purchaseOrderId: params.po_id,
            goodsReceipts: grList
        };
    }

    function post(params) {
        try {
            var result = receiptPurchaseOrder(params);
            return {
                success: true,
                purchase_order_id: result.purchaseOrderId,
                goods_receipts: result.goodsReceipts
            };
        } catch (e) {
            return {
                success: false,
                message: e.message
            };
        }
    }

    return {
        post: post
    };
});
