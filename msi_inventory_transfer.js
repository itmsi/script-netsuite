/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Create Inventory Transfer (Item Transfer) via POST
 * Memindahkan item antar lokasi secara langsung (tanpa Transfer Order)
 *
 * POST body lengkap sesuai UI:
  {
   "subsidiary"   : 5,               // Internal ID Subsidiary (wajib)
   "from_location": 19,              // Internal ID lokasi asal (wajib, set 'From Location')
   "to_location"  : 22,              // Internal ID lokasi tujuan (wajib, set 'To Location')
   "trandate"     : "26-03-2026",    // Tanggal transfer (opsional, default: hari ini)
   "department"   : 8,               // Internal ID Department (wajib jika Mandatory di UI)
   "class"        : 1,               // Internal ID Class (wajib jika Mandatory di UI)
   "memo"         : "perpindahan unit dari jakarta ke sulawesi",  // Memo (opsional)
    "custom_fields": {                
       "custbody_me_description": "perpindahan unit dari jakarta ke sulawesi"
   },
   "lines": [
     {
       "item"         : 26606,           // Internal ID item (wajib)
       "quantity"     : 1,             // Jumlah yang dipindah / Qty To Transfer (wajib)
       "description"  : "perpindahan unit",  // Deskripsi line ,
       "serials": ["VIN-002-7"]   
     }
   ]
 }


 */
define(['N/record', 'N/format'], function (record, format) {

    function post(body) {
        try {

            // =========================
            // 🔥 VALIDASI INPUT
            // =========================
            var subsidiaryId  = body.subsidiary;
            var fromLocationId = body.from_location;
            var toLocationId   = body.to_location;

            if (!fromLocationId || !toLocationId) {
                return {
                    status : 'error',
                    message: '"from_location" dan "to_location" wajib diisi'
                };
            }

            if (!body.lines || body.lines.length === 0) {
                return {
                    status : 'error',
                    message: '"lines" wajib diisi dan tidak boleh kosong'
                };
            }

            // =========================
            // 🔥 CREATE INVENTORY TRANSFER
            // =========================
            var transfer = record.create({
                type     : record.Type.INVENTORY_TRANSFER,
                isDynamic: true
            });

            // Set custom form (BANTUAN PENTING jika custom field tersembunyi di form standar)
            if (body.customform) {
                transfer.setValue({ fieldId: 'customform', value: body.customform });
            }

            // Set subsidiary
            if (subsidiaryId) {
                transfer.setValue({ fieldId: 'subsidiary', value: subsidiaryId });
            }

            // Set lokasi via Header (Dari UI: Primary Information)
            transfer.setValue({ fieldId: 'location', value: fromLocationId });
            
            // "transferlocation" adalah internal id untuk field "To Location" di header record Inventory Transfer
            transfer.setValue({ fieldId: 'transferlocation', value: toLocationId });

            // Set tanggal
            if (body.trandate) {
                var dateObj;
                var t = body.trandate;
                var parts;
                
                if (t.indexOf('-') > -1 && t.split('-')[0].length === 4) {
                    // YYYY-MM-DD
                    parts = t.split('-');
                    dateObj = new Date(parts[0], parseInt(parts[1], 10) - 1, parts[2]);
                } else if (t.indexOf('-') > -1 && t.split('-')[2].length === 4) {
                    // DD-MM-YYYY
                    parts = t.split('-');
                    dateObj = new Date(parts[2], parseInt(parts[1], 10) - 1, parts[0]);
                } else if (t.indexOf('/') > -1 && t.split('/')[2].length === 4) {
                    // DD/MM/YYYY
                    parts = t.split('/');
                    dateObj = new Date(parts[2], parseInt(parts[1], 10) - 1, parts[0]);
                } else {
                    // Fallback to N/format if arbitrary format
                    try {
                        dateObj = format.parse({
                            value: t,
                            type : format.Type.DATE
                        });
                    } catch(e) {
                        dateObj = new Date(t);
                    }
                }

                if (!dateObj || isNaN(dateObj.getTime())) {
                    throw new Error("Format trandate tidak valid. Gunakan format YYYY-MM-DD atau DD/MM/YYYY. Input: " + t);
                }

                transfer.setValue({ fieldId: 'trandate', value: dateObj });
            }

            // Set posting period
            if (body.postingperiod) {
                transfer.setValue({ fieldId: 'postingperiod', value: body.postingperiod });
            }

            // Set department
            if (body.department) {
                transfer.setValue({ fieldId: 'department', value: body.department });
            }

            // Set class
            if (body.class) {
                transfer.setValue({ fieldId: 'class', value: body.class });
            }

            // Set memo
            if (body.memo) {
                transfer.setValue({ fieldId: 'memo', value: body.memo });
            }

            // Set custom fields di body (custbody_...)
            if (body.custom_fields && typeof body.custom_fields === 'object') {
                for (var key in body.custom_fields) {
                    if (body.custom_fields.hasOwnProperty(key)) {
                        transfer.setValue({
                            fieldId: key,
                            value  : body.custom_fields[key]
                        });
                    }
                }
            }

            // =========================
            // 🔥 LOOP LINES
            // =========================
            for (var l = 0; l < body.lines.length; l++) {
                var lineData = body.lines[l];

                if (!lineData.item) {
                    throw new Error('item wajib diisi di baris ke-' + (l + 1));
                }

                var qty = lineData.quantity;
                if (lineData.serials && lineData.serials.length > 0) {
                    qty = lineData.serials.length;
                }

                if (!qty || qty <= 0) {
                    throw new Error('quantity tidak valid di baris ke-' + (l + 1));
                }

                transfer.selectNewLine({ sublistId: 'inventory' });

                // Set Item
                transfer.setCurrentSublistValue({
                    sublistId: 'inventory',
                    fieldId  : 'item',
                    value    : lineData.item
                });

                // Set Units
                if (lineData.units) {
                    try {
                        // Deteksi apakah user mengirim teks (misalnya "PCS") atau angka Internal ID
                        if (typeof lineData.units === 'string' && isNaN(Number(lineData.units))) {
                            transfer.setCurrentSublistText({
                                sublistId: 'inventory',
                                fieldId  : 'units',
                                text     : lineData.units
                            });
                        } else {
                            transfer.setCurrentSublistValue({
                                sublistId: 'inventory',
                                fieldId  : 'units',
                                value    : lineData.units
                            });
                        }
                    } catch (e) {
                    }
                }

                // Set Description
                if (lineData.description) {
                    transfer.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId  : 'description',
                        value    : lineData.description
                    });
                }

                // Set Quantity ("Qty. To Transfer" -> 'adjustqtyby')
                transfer.setCurrentSublistValue({
                    sublistId: 'inventory',
                    fieldId  : 'adjustqtyby',
                    value    : qty
                });
                
                // Set custom fields di line (custcol_...)
                if (lineData.custom_fields && typeof lineData.custom_fields === 'object') {
                    for (var lineKey in lineData.custom_fields) {
                        if (lineData.custom_fields.hasOwnProperty(lineKey)) {
                            transfer.setCurrentSublistValue({
                                sublistId: 'inventory',
                                fieldId  : lineKey,
                                value    : lineData.custom_fields[lineKey]
                            });
                        }
                    }
                }

                // =========================
                // 🔥 INVENTORY DETAIL (serial/lot)
                // =========================
                if (lineData.serials && lineData.serials.length > 0) {
                    try {
                        var inventoryDetail = transfer.getCurrentSublistSubrecord({
                            sublistId: 'inventory',
                            fieldId  : 'inventorydetail'
                        });

                        for (var s = 0; s < lineData.serials.length; s++) {
                            inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });

                            var serialVal = lineData.serials[s];
                            // Jika serial formatnya string karakter (bukan ID angka murni), gunakan setText
                            if (typeof serialVal === 'string' && isNaN(Number(serialVal))) {
                                inventoryDetail.setCurrentSublistText({
                                    sublistId: 'inventoryassignment',
                                    fieldId  : 'issueinventorynumber',
                                    text     : serialVal
                                });
                            } else {
                                inventoryDetail.setCurrentSublistValue({
                                    sublistId: 'inventoryassignment',
                                    fieldId  : 'issueinventorynumber',
                                    value    : serialVal
                                });
                            }

                            inventoryDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId  : 'quantity',
                                value    : 1
                            });

                            inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
                        }
                    } catch (invErr) {
                        throw new Error('Gagal set serial number baris ' + (l + 1) + ': ' + invErr.message);
                    }
                }

                transfer.commitLine({ sublistId: 'inventory' });
            }

            // =========================
            // 🔥 SAVE — langsung pindah
            // =========================
            var newId = transfer.save({
                enableSourcing      : true,
                ignoreMandatoryFields: false
            });

            return {
                status              : 'success',
                message             : 'Inventory Transfer berhasil dibuat',
                inventory_transfer_id: newId,
                from_location       : fromLocationId,
                to_location         : toLocationId
            };

        } catch (e) {
            return {
                status : 'error',
                name   : e.name,
                message: e.message,
                stack  : e.stack
            };
        }
    }

    return { post: post };
});
