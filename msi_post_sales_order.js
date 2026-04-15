/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 *
 * RESTlet script untuk membuat (Create) atau mengupdate (Update) Sales Order.
 * Metode pembaruan baris (Smart Update): Update baris item jika itemId sama, tambah jika baru, hapus penanda baris yang terlewat dari target.
 *
 * === CONTOH PAYLOAD (POST BODY) ===
 {
   "id": 7540,                           // Opsional: Isi dengan Internal ID SO jika ingin UPDATE. Kosongkan jika ingin CREATE.
   "customform": 104,                     // Internal ID custom form (opsional)
   "subsidiary": 5,                       // Internal ID dari Subsidiary
   "entity": 1052,                     // Internal ID dari Customer (bisa juga menggunakan key "entity")
   "trandate": "20/3/2026",               // Tanggal Transaksi (format string date parsing NetSuite)
   "startdate": "20/3/2026",              // Tanggal Mulai (format string date)
   "enddate": "23/3/2026",                // Tanggal Berakhir (format string date)
   "orderstatus": "B",                    // Status Order A = Pending Approval, B = Pending Fullfillment
   "otherrefnum": "",              // Nomor Referensi Lain / PO #
   "memo": "Catatan untuk SO ini",      
   "currency": 1,                         // Internal ID Mata Uang (Currency)
   "terms": 9,                            // Internal ID Payment Terms
   "department": 101,                      // Internal ID Department
   "class": 3,                           // Internal ID Class
   "location": 19,                         // Internal ID Location
//    "intercotransaction": 1,             // Internal ID transaksi intercompany
   "custbody_msi_quotation_no_iec": "QT-001", 
   "custbody_msi_bank_payment_so": [3, 5],
   "custbody_cseg_cn_cfi": 4, 
   "custbody_msi_createdby_api": "T", 
   "custbody_me_approval_status": 2, // 1 = pending approval, 2 = approved, 3 = Rejected
   "items": [
     {
       "itemId": 19593,                     // Internal ID item (wajib)
       "qty": 5,                          // Quantity item (bisa juga "quantity": 5)
       "rate": 1500000,                    // Harga satuan item
       "amount": 7500000,                  // Total Amount
       "description": "Deskripsi Manual", // Deskripsi item
       "department": 101,                 
       "class": 3,                      
       "location": 19,                    
       "taxcode": 18098,                       // Internal ID kode pajak
       "custcol_me_tier_price": 100000,   // Harga tier
       "custcol_msi_booking_fee_so": 5000000, // Booking fee msi - booking fee -> khusus iec dan msi kalau iel auto 0
       "custcol_msi_down_payment_percent": 30, // Persentase uang muka (%) msi - down payment persen dan 
       "custcol_msi_down_payment_amount": 30000000 // Nominal uang muka msi - down payment amount
     }
   ]
 }
 */
define(['N/record','N/format'], function (record, format) {

    function post(context) {
        try {            
            var so;
            if (context.id) {
                so = record.load({
                    type: record.Type.SALES_ORDER,
                    id: context.id,
                    isDynamic: true
                });

                if (context.customform) {
                    so.setValue({
                        fieldId: 'customform', 
                        value: context.customform
                    });
                }

                if (context.subsidiary) {
                    so.setValue({
                        fieldId: 'subsidiary',
                        value: context.subsidiary
                    });
                }
          
                if (context.customerid) {
                    so.setValue({
                        fieldId: 'entity', // Customer Internal ID
                        value: context.customerid
                    });
                } else if (context.entity) {
                    so.setValue({
                        fieldId: 'entity', // Support either entity or customerid
                        value: context.entity
                    });
                }
            } 
            else {
                so = record.create({
                    type: record.Type.SALES_ORDER,
                    isDynamic: true
                });

                if (context.customform) {
                    so.setValue({
                        fieldId: 'customform', 
                        value: context.customform
                    });
                }

                if (context.customerid) {
                    so.setValue({
                        fieldId: 'entity', // Customer Internal ID
                        value: context.customerid
                    });
                } else if (context.entity) {
                    so.setValue({
                        fieldId: 'entity',
                        value: context.entity
                    });
                }
            
                if (context.subsidiary) {
                    so.setValue({
                        fieldId: 'subsidiary',
                        value: context.subsidiary
                    });
                }
            }

            // ===== HEADER =====

            if (context.trandate) {
                var tranDateObj = format.parse({
                  value: context.trandate,
                  type: format.Type.DATE
                });
                so.setValue({ fieldId: 'trandate', value: tranDateObj });
            }

            if (context.startdate) {
                var startDateObj = format.parse({
                  value: context.startdate,
                  type: format.Type.DATE
                });
                so.setValue({ fieldId: 'startdate', value: startDateObj });
            }

            if (context.enddate) {
                var endDateObj = format.parse({
                  value: context.enddate,
                  type: format.Type.DATE
                });
                so.setValue({ fieldId: 'enddate', value: endDateObj });
            }

            if (context.orderstatus) {
                so.setValue({ fieldId: 'orderstatus', value: context.orderstatus });
            }

            if (context.otherrefnum) {
                so.setValue({ fieldId: 'otherrefnum', value: context.otherrefnum });
            }
            
            if (context.location) {
                so.setValue({ fieldId: 'location', value: context.location });
            }

            if (context.memo) {
                so.setValue({ fieldId: 'memo', value: context.memo });
            }

            if (context.currency) {
                so.setValue({ fieldId: 'currency', value: context.currency });
            }
          
            if (context.terms) {
                so.setValue({ fieldId: 'terms', value: context.terms });
            }

            if (context.custbody_msi_quotation_no_iec) {
                so.setValue({ fieldId: 'custbody_msi_quotation_no_iec', value: context.custbody_msi_quotation_no_iec });
            }

            if (context.custbody_msi_bank_payment_so !== undefined && context.custbody_msi_bank_payment_so !== null) {
                var bankPaymentVal = Array.isArray(context.custbody_msi_bank_payment_so)
                    ? context.custbody_msi_bank_payment_so
                    : [context.custbody_msi_bank_payment_so];
                so.setValue({ fieldId: 'custbody_msi_bank_payment_so', value: bankPaymentVal });
            }

            if (context.custbody_cseg_cn_cfi) {
                so.setValue({ fieldId: 'custbody_cseg_cn_cfi', value: context.custbody_cseg_cn_cfi });
            }

            if (context.intercotransaction) {
                so.setValue({ fieldId: 'intercotransaction', value: context.intercotransaction });
            }

            if (context.class) {
                so.setValue({ fieldId: 'class', value: context.class });
            }

            if (context.department) {
                so.setValue({ fieldId: 'department', value: context.department });
            }

            if (context.custbody_msi_createdby_api !== undefined) {
                so.setValue({ fieldId: 'custbody_msi_createdby_api', value: context.custbody_msi_createdby_api });
            }

            if (context.custbody_me_approval_status !== undefined) {
                so.setValue({ fieldId: 'custbody_me_approval_status', value: context.custbody_me_approval_status });
            }
          
            // ===== ITEMS =====

            var isUpdate = !!context.id;
            var lineCount = isUpdate ? so.getLineCount({ sublistId: 'item' }) : 0;
            var existingItems = [];
            
            for (var i = 0; i < lineCount; i++) {
                existingItems.push({
                    index: i,
                    item: so.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }),
                    processed: false
                });
            }
          
            if (context.items) {
                context.items.forEach(function (payloadItem) {
                    var targetItemId = payloadItem.itemId || payloadItem.item;
                    
                    var matchIndex = -1;
                    if (isUpdate && targetItemId) {
                        for (var j = 0; j < existingItems.length; j++) {
                            if (!existingItems[j].processed && existingItems[j].item == targetItemId) {
                                matchIndex = existingItems[j].index;
                                existingItems[j].processed = true;
                                break;
                            }
                        }
                    }

                    if (matchIndex !== -1) {
                        so.selectLine({ sublistId: 'item', line: matchIndex });
                    } else {
                        so.selectNewLine({ sublistId: 'item' });
                        if (targetItemId) {
                            so.setCurrentSublistValue({
                                sublistId: 'item',
                                fieldId: 'item',
                                value: targetItemId
                            });
                        }
                    }

                    var qty = payloadItem.qty || payloadItem.quantity;
                    if (qty) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            value: qty
                        });
                    }

                    if (payloadItem.description) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'description',
                            value: payloadItem.description
                        });
                    }

                    if (payloadItem.rate !== undefined && payloadItem.rate !== null) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'rate',
                            value: payloadItem.rate
                        });
                    }

                    if (payloadItem.amount !== undefined && payloadItem.amount !== null) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'amount',
                            value: payloadItem.amount
                        });
                    }

                    if (payloadItem.department) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'department',
                            value: payloadItem.department
                        });
                    }

                    if (payloadItem.class) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'class',
                            value: payloadItem.class
                        });
                    }

                    if (payloadItem.location) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'location',
                            value: payloadItem.location
                        });
                    }

                    if (payloadItem.taxcode) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'taxcode',
                            value: payloadItem.taxcode
                        });
                    }

                    if (payloadItem.custcol_me_tier_price !== undefined && payloadItem.custcol_me_tier_price !== null) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_me_tier_price',
                            value: payloadItem.custcol_me_tier_price
                        });
                    }

                    if (payloadItem.custcol_msi_booking_fee_so !== undefined && payloadItem.custcol_msi_booking_fee_so !== null) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_msi_booking_fee_so',
                            value: payloadItem.custcol_msi_booking_fee_so
                        });
                    }

                    if (payloadItem.custcol_msi_down_payment_percent !== undefined && payloadItem.custcol_msi_down_payment_percent !== null) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_msi_down_payment_percent',
                            value: payloadItem.custcol_msi_down_payment_percent
                        });
                    }

                    if (payloadItem.custcol_msi_down_payment_amount !== undefined && payloadItem.custcol_msi_down_payment_amount !== null) {
                        so.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'custcol_msi_down_payment_amount',
                            value: payloadItem.custcol_msi_down_payment_amount
                        });
                    }

                    so.commitLine({ sublistId: 'item' });
                });

                if (isUpdate) {
                    for (var k = existingItems.length - 1; k >= 0; k--) {
                        if (!existingItems[k].processed) {
                            try {
                                so.removeLine({ sublistId: 'item', line: existingItems[k].index });
                            } catch (e) {
                                log.error('Failed to remove line', e);
                            }
                        }
                    }
                }
            }

            var soId = so.save();
            return {
                success: true,
                soId: soId
            };

        } catch (e) {
            return {
                success: false,
                error: typeof e.message === 'string' ? e.message : JSON.stringify(e)
            };
        }
    }

    return {
        post: post
    };
});
