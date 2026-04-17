/**
 *@NApiVersion 2.1
 *@NScriptType Restlet
 */

 /*
 Body request
{
  "po_id": 7228,
  "memo": "standart item receipt",
  "customform": 115,     // opsional: ID custom form
  "trandate": "2026-04-17", // opsional: format tanggal ISO atau string date
  "class": 2,            // opsional: ID class header
  "location": 19,        // opsional: ID location header
  "department": 6,       // opsional: ID department header
  "items": [
    {
      "item": 19611,
      "quantity": 1,
      "location": 19,    // opsional: ID To Location line
      "department": 6,   // opsional: ID department line
      "class": 2,        // opsional: ID class line
      "rate": 150000     // opsional: set rate/harga line
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

        // Set field header dasar
        var bodyFields = ['memo', 'customform', 'class', 'location', 'department'];
        bodyFields.forEach(function(field) {
            if (params[field] !== undefined && params[field] !== null) {
                loadRec.setValue({ fieldId: field, value: params[field] });
            }
        });

        // Set trandate khusus (perlu object Date)
        if (params.trandate) {
            var inputDate = params.trandate;
            var d = new Date(inputDate);
            
            // Coba parse manual kalau JS Date gagal (misal "16-04-2026")
            if (isNaN(d.getTime())) {
                var parts = inputDate.split(/[-/]/); // support pemisah '-' atau '/'
                if (parts.length === 3) {
                    if (parts[0].length === 4) {
                        // format YYYY-MM-DD
                        d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                    } else if (parts[2].length === 4) {
                        // format DD-MM-YYYY
                        d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
                    }
                }
            }
            
            if (!isNaN(d.getTime())) {
                loadRec.setValue({ fieldId: 'trandate', value: d });
            }
        }

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
            
            // Set info detail per line item
            var lineFields = ['location', 'department', 'class', 'rate'];
            lineFields.forEach(function(f) {
                if (itemData[f] !== undefined && itemData[f] !== null) {
                    // Di Item Receipt, term/field internal-nya adalah 'unitcost', bukan 'rate'
                    var nsFieldId = (f === 'rate') ? 'unitcost' : f;
                    loadRec.setSublistValue({
                        sublistId: 'item',
                        fieldId: nsFieldId,
                        line: lineNumber,
                        value: itemData[f]
                    });
                }
            });
            
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
