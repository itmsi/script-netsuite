/**
 * @NApiVersion 2.x
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
    "status": "A",                         // (Optional) Order Status
    "incoterm": 6,                         // (Optional) Incoterm internal ID
    "employee": 7,                         // (Optional) Employee internal ID
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

            if (context.status) {
                toRec.setValue({ fieldId: 'orderstatus', value: context.status });
            }

            if (context.incoterm) {
                toRec.setValue({ fieldId: 'incoterm', value: context.incoterm });
            }

            if (context.employee) {
                toRec.setValue({ fieldId: 'employee', value: context.employee });
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
            var toId = toRec.save({
                enableSourcing: true,
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
