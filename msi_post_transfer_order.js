/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * CREATE / UPDATE Transfer Order
 * 
 * ==========================================
 * EXPECTED PAYLOAD STRUCTURE (JSON)
 * ==========================================
 {
    "id": 12345,                           // (Optional) Internal ID for UPDATE. If empty, will CREATE new Transfer Order.
    "customform": 135,                     // (Optional) Custom form internal ID
    "subsidiary": 1,                       // (Optional) Subsidiary internal ID
    "location": 2,                         // (Optional) From Location internal ID (can also use "from_location_id")
    "transferlocation": 3,                 // (Optional) To Location internal ID (can also use "to_location_id")
    "trandate": "1/31/2024",               // (Optional) Date string matching NetSuite date format preference
    "memo": "Transfer order memo",         // (Optional) Memo
    "department": 4,                       // (Optional) Department internal ID
    "class": 5,                            // (Optional) Class internal ID
    "incoterm": 6,                         // (Optional) Incoterm internal ID
    "employee": 7,                         // (Optional) Employee internal ID
    "firmed": true,                        // (Optional) Firmed checkbox
    "useitemcostastransfercost": true,     // (Optional) Use Item Cost As Transfer Cost checkbox
    "custbody_me_logistic_vendor": 8,      // (Optional) Logistic Vendor internal ID (auto-mapped lewat custbody_*)
    "custbody_me_inv_customer": 9,         // (Optional) Customer internal ID (auto-mapped lewat custbody_*)
    "custbody_...": "value",               // (Optional) Any custom body field starting with 'custbody' will be auto-mapped
    
    "items": [                             // (Optional) Array of line items
        {
            "item": 1001,                  // Item internal ID (can also use "item_id")
            "quantity": 10,                // Quantity
            "description": "Item desc",    // (Optional) Line description (can also use "memo")
            "department": 4,               // (Optional) Line department
            "class": 5,                    // (Optional) Line class
            "expectedshipdate": "2/1/2024",// (Optional) Expected Ship Date
            "expectedreceiptdate": "2/5/2024",// (Optional) Expected Receipt Date
            "rate": 100000,                // (Optional) Transfer Price (can also use "transfer_price"). Amount otomatis = rate * quantity. JANGAN dikirim bareng "amount" - NetSuite selalu recalc Amount dari Rate x Qty saat commit, jadi Rate menang & override "amount" manapun
            "amount": 1000000,             // (Optional) Kirim INI SAJA (tanpa "rate") kalau mau set total Amount secara manual/independen, misal saat "Use Item Cost As Transfer Cost" aktif (Rate jadi read-only, hanya Amount yang bisa di-override)
            "custcol_...": "value"         // (Optional) Any custom column field starting with 'custcol' will be auto-mapped
        }
    ],
    
    "files": [                             // (Optional) Array of file attachments (URL-based)
        {
            "file_name": "document.pdf",
            "file_url": "https://example.com/document.pdf"
        }
    ]
 }
 *
 * =============================================
 * CATATAN STATUS (Pending Fulfillment / Pending Receipt / Received)
 * Status Transfer Order TIDAK BISA di-set manual lewat field 'orderstatus'
 * (NetSuite menolak dengan "Invalid Field Value") — field itu murni
 * computed berdasarkan progres fulfillment/receipt yang sebenarnya.
 * Untuk memajukan status ke "Received", buat Item Receipt dari TO ini
 * lewat msi_post_transfer_order_item_receipt.js (record.transform).
 * =============================================
 */
define(['N/record', 'N/format', 'N/search', 'N/log'], function (record, format, search, log) {

    function post(context) {
        var files = context.files;
        try {
            var toRec;

            // 1. CREATE or UPDATE
            if (context.id) {
                toRec = record.load({
                    type: record.Type.TRANSFER_ORDER,
                    id: context.id,
                    isDynamic: true
                });
            } else {
                toRec = record.create({
                    type: record.Type.TRANSFER_ORDER,
                    isDynamic: true
                });
            }

            // 2. HEADER FIELDS
            if (context.customform) {
                toRec.setValue({ fieldId: 'customform', value: context.customform });
            }

            if (context.subsidiary) {
                toRec.setValue({ fieldId: 'subsidiary', value: context.subsidiary });
            }

            if (context.from_location_id || context.location) {
                toRec.setValue({ fieldId: 'location', value: context.from_location_id || context.location });
            }

            if (context.to_location_id || context.transferlocation) {
                toRec.setValue({ fieldId: 'transferlocation', value: context.to_location_id || context.transferlocation });
            }

            if (context.trandate) {
                var trandateObj = format.parse({
                    value: context.trandate,
                    type: format.Type.DATE
                });
                toRec.setValue({ fieldId: 'trandate', value: trandateObj });
            }

            if (context.memo) {
                toRec.setValue({ fieldId: 'memo', value: context.memo });
            }

            if (context.department) {
                toRec.setValue({ fieldId: 'department', value: context.department });
            }

            if (context.class) {
                toRec.setValue({ fieldId: 'class', value: context.class });
            }

            if (context.incoterm) {
                toRec.setValue({ fieldId: 'incoterm', value: context.incoterm });
            }

            if (context.employee) {
                toRec.setValue({ fieldId: 'employee', value: context.employee });
            }

            if (context.firmed !== undefined) {
                toRec.setValue({ fieldId: 'firmed', value: context.firmed });
            }

            if(context.useitemcostastransfercost) {
              toRec.setValue({ fieldId: 'useitemcostastransfercost', value: context.useitemcostastransfercost});
            }

             if(context.custbody_msi_createdby_api) {
              toRec.setValue({ fieldId: 'custbody_msi_createdby_api', value: context.custbody_msi_createdby_api});
            }

            // AUTO-MAP HEADER CUSTBODY_*
            for (var key in context) {
                if (key.indexOf('custbody') === 0) {
                    try {
                        toRec.setValue({ fieldId: key, value: context[key] });
                    } catch (e) {
                        log.error('Set Header Custom Field Error', key + ' - ' + e.message);
                    }
                }
            }

            // 3. LINES
            if (context.items && context.items.length > 0) {

                // Jika UPDATE, hapus semua line lama (replace all)
                if (context.id) {
                    var lineCount = toRec.getLineCount({ sublistId: 'item' });
                    for (var i = lineCount - 1; i >= 0; i--) {
                        toRec.removeLine({ sublistId: 'item', line: i });
                    }
                }

                context.items.forEach(function (item) {
                    toRec.selectNewLine({ sublistId: 'item' });

                    // Standard line fields
                    if (item.item_id || item.item) {
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item.item_id || item.item });
                    }
                    if (item.quantity !== undefined) {
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: item.quantity });
                    }
                    if (item.description || item.memo) {
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'description', value: item.description || item.memo });
                    }
                    if (item.department) {
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'department', value: item.department });
                    }
                    if (item.class) {
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'class', value: item.class });
                    }
                    if (item.rate !== undefined || item.transfer_price !== undefined) {
                        var lineRate = item.rate !== undefined ? item.rate : item.transfer_price;
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'rate', value: lineRate });

                        // Default Amount = qty x rate (buat kondisi Rate disabled/cost-sourced di UI).
                        // Kalau item.amount eksplisit dikirim, itu akan menimpa nilai ini di bawah.
                        var lineQty = item.quantity !== undefined ? item.quantity : toRec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity' });
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: lineRate * lineQty });
                    }
                    if (item.amount !== undefined) {
                        toRec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'amount', value: item.amount });
                    }

                    // Dates on line level
                    if (item.expectedshipdate) {
                        toRec.setCurrentSublistValue({ 
                            sublistId: 'item', fieldId: 'expectedshipdate', 
                            value: format.parse({ value: item.expectedshipdate, type: format.Type.DATE }) 
                        });
                    }
                    if (item.expectedreceiptdate) {
                        toRec.setCurrentSublistValue({ 
                            sublistId: 'item', fieldId: 'expectedreceiptdate', 
                            value: format.parse({ value: item.expectedreceiptdate, type: format.Type.DATE }) 
                        });
                    }

                    // AUTO-MAP LINE CUSTCOL_*
                    for (var lineKey in item) {
                        if (lineKey.indexOf('custcol') === 0) {
                            try {
                                toRec.setCurrentSublistValue({
                                    sublistId: 'item', fieldId: lineKey, value: item[lineKey]
                                });
                            } catch (e) {
                                log.error('Set Line Custom Field Error', lineKey + ' - ' + e.message);
                            }
                        }
                    }

                    toRec.commitLine({ sublistId: 'item' });
                });
            }

            // 4. SAVE
            // enableSourcing:false biar Amount yang di-set manual (item.amount / item.rate x qty)
            // tidak ke-recalculate ulang dari Rate x Quantity oleh sourcing engine NetSuite saat save.
            // NOTE: kalau "useitemcostastransfercost" (Use Item Cost As Transfer Cost) dipakai, cek lagi
            // apakah Rate masih ke-source otomatis dari Item Cost dgn enableSourcing:false ini.
            var toId = toRec.save({
                enableSourcing: false,
                ignoreMandatoryFields: true
            });

            // 5. ATTACH MULTIPLE FILE (URL)
            // (Sama seperti di Purchase Order script)
            if (context.id) {
                var recFileSearch = search.create({
                    type: 'customrecord_msi_web_url_file',
                    filters: [
                        ['custrecord_msi_transaction_id', 'is', context.id],
                        'AND',
                        ['isinactive', 'is', 'F']
                    ],
                    columns: ['internalid']
                });

                recFileSearch.run().each(function (result) {
                    var recId = result.getValue('internalid');
                    record.submitFields({
                        type: 'customrecord_msi_web_url_file',
                        id: recId,
                        values: { isinactive: true },
                        options: { enableSourcing: false, ignoreMandatoryFields: true }
                    });
                    return true;
                });
            }

            var resultfileid = [];
            if (files && files.length > 0) {
                for (var i = 0; i < files.length; i++) {
                    var recFile = record.create({
                        type: 'customrecord_msi_web_url_file',
                        isDynamic: true
                    });

                    recFile.setValue({
                        fieldId: 'custrecord_msi_web_related_transaction',
                        value: toId
                    });

                    recFile.setValue({
                        fieldId: 'custrecord_msi_transaction_id',
                        value: toId
                    });

                    recFile.setValue({
                        fieldId: 'name',
                        value: files[i].file_name
                    });

                    recFile.setValue({
                        fieldId: 'custrecord_msi_web_url_file',
                        value: files[i].file_url
                    });

                    var fid = recFile.save();
                    resultfileid.push(fid);
                }
            }

            // 6. BUILD RESPONSE
            var fields = search.lookupFields({
                type: search.Type.TRANSFER_ORDER,
                id: toId,
                columns: ['tranid']
            });

            return {
                success: true,
                message: context.id ? "Transfer Order updated successfully" : "Transfer Order created successfully",
                transfer_order_id: toId,
                tranid: fields.tranid,
                files_attached: resultfileid
            };

        } catch (e) {
            log.error('POST ERROR', e);
            return {
                success: false,
                message: e.message
            };
        }
    }

    return { post: post };
});
