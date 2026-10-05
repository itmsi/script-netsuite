/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * CREATE / UPDATE Inventory Transfer (Item Transfer) via POST
 * Memindahkan item antar lokasi secara langsung (tanpa Transfer Order)
 *
 * POST body lengkap sesuai UI:
  {
   "id"           : 80354,            // (Opsional) Internal ID untuk UPDATE. Kosongkan untuk CREATE baru.
   "subsidiary"   : 6,               // Internal ID Subsidiary (wajib saat create)
   "from_location": 1,              // Internal ID lokasi asal (wajib saat create, set 'From Location')
   "to_location"  : 221,              // Internal ID lokasi tujuan (wajib saat create, set 'To Location')
   "trandate"     : "26-03-2026",    // Tanggal transfer (opsional, default: hari ini)
   "department"   : 3,               // Internal ID Department (wajib jika Mandatory di UI)
   "class"        : 1,               // Internal ID Class (wajib jika Mandatory di UI)
   "memo"         : "perpindahan unit dari jakarta ke sulawesi",  // Memo (opsional)
   "custbody_msi_approved_custom_price": false,  // (Opsional) checkbox "MSI - Approved Custom Price"
   "generatetranidonsave": true,    // (Opsional) false = pakai nomor manual dari "tranid" di bawah, true/kosong = auto-generate NetSuite
   "tranid"       : "TI-CUSTOM-001", // (Opsional) Ref No. manual - dipakai hanya kalau generatetranidonsave: false
   "lines": [                        // (Opsional saat update - kalau dikirim, semua line lama diganti/replace-all)
     {
       "item"         : 22230,           // Internal ID item (wajib)
       "units"        : "PCS",           // Units line (opsional, terima teks "PCS" atau internal ID)
       "quantity"     : 1,             // Jumlah yang dipindah / Qty To Transfer (wajib)
       "serials"      : ["VIN-002-7"],   // Inventory Detail (serial/lot number) - untuk item Serialized/Lot
       "inventorystatus": 1,             // (Opsional, default: 1/"Good") Inventory Status "From Status" - untuk
                                          // item yang pakai fitur "Multiple Inventory Statuses" tapi BUKAN
                                          // serialized/lot (jangan dikirim bareng "serials")
       "toinventorystatus": 1,           // (Opsional, default: sama dengan "inventorystatus") Inventory Status "To Status"
       "apply_wh_tax" : false,           // (Opsional) Apply WH Tax? checkbox
       "related_asset": 2846,             // (Opsional) Related Asset - internal ID Fixed Asset record
       "cseg_msi_pro_segmen": 3         // (Opsional) Project Segmentation - internal ID custom segment
     }
   ]
 }


 */
define(['N/record', 'N/format', 'N/search'], function (record, format, search) {

    function post(body) {
        try {

            var isUpdate = !!body.id;

            // =========================
            // 🔥 VALIDASI INPUT
            // =========================
            var subsidiaryId  = body.subsidiary;
            var fromLocationId = body.from_location;
            var toLocationId   = body.to_location;

            // "from_location" / "to_location" / "lines" cuma wajib saat CREATE.
            // Saat UPDATE, field-field ini opsional - kalau tidak dikirim,
            // nilai yang sudah ada di record tetap dipakai (record.load).
            if (!isUpdate) {
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
            }

            // =========================
            // 🔥 CREATE atau LOAD (UPDATE) INVENTORY TRANSFER
            // =========================
            var transfer = isUpdate
                ? record.load({
                    type     : record.Type.INVENTORY_TRANSFER,
                    id       : body.id,
                    isDynamic: true
                })
                : record.create({
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
            // Opsional saat update - kalau tidak dikirim, lokasi existing di record dipertahankan.
            if (fromLocationId) {
                transfer.setValue({ fieldId: 'location', value: fromLocationId });
            }

            // "transferlocation" adalah internal id untuk field "To Location" di header record Inventory Transfer
            if (toLocationId) {
                transfer.setValue({ fieldId: 'transferlocation', value: toLocationId });
            }

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

            // Set MSI - Approved Custom Price (checkbox header)
            if (body.custbody_msi_approved_custom_price !== undefined) {
                transfer.setValue({ fieldId: 'custbody_msi_approved_custom_price', value: body.custbody_msi_approved_custom_price });
            }

            // Set generatetranidonsave (true = biarkan NetSuite auto-generate Ref No,
            // false = pakai nomor manual dari field "tranid"). Kalau di-set false,
            // kirim juga "tranid" di body supaya nomornya tidak kosong.
            if (body.generatetranidonsave !== undefined) {
                transfer.setValue({ fieldId: 'generatetranidonsave', value: body.generatetranidonsave });
            }

            // Set Ref No. manual (pasangan dari generatetranidonsave: false)
            if (body.tranid) {
                transfer.setValue({ fieldId: 'tranid', value: body.tranid });
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
            // Saat UPDATE, "lines" opsional. Kalau dikirim, semua line lama
            // dihapus dulu (replace-all) baru diisi ulang dari payload - sama
            // seperti pola di msi_post_transfer_order.js.
            if (body.lines && body.lines.length > 0) {

            if (isUpdate) {
                var existingLineCount = transfer.getLineCount({ sublistId: 'inventory' });
                for (var rm = existingLineCount - 1; rm >= 0; rm--) {
                    transfer.removeLine({ sublistId: 'inventory', line: rm });
                }
            }

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

                // Set Apply WH Tax? (custcol_4601_witaxapplies)
                if (lineData.apply_wh_tax !== undefined) {
                    transfer.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId  : 'custcol_4601_witaxapplies',
                        value    : lineData.apply_wh_tax
                    });
                }

                // Set Related Asset (custcol_far_trn_relatedasset)
                if (lineData.related_asset !== undefined) {
                    transfer.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId  : 'custcol_far_trn_relatedasset',
                        value    : lineData.related_asset
                    });
                }

                // Set Project Segmentation (cseg_msi_pro_segmen)
                if (lineData.cseg_msi_pro_segmen !== undefined) {
                    transfer.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId  : 'cseg_msi_pro_segmen',
                        value    : lineData.cseg_msi_pro_segmen
                    });
                }

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

                        // Hapus baris default yang mungkin sudah ditarik otomatis oleh
                        // NetSuite pas subrecord ini pertama kali diakses, biar tidak
                        // bentrok/dobel qty sama baris yang kita isi manual di bawah.
                        var existingSerialLines = inventoryDetail.getLineCount({ sublistId: 'inventoryassignment' });
                        for (var rmS = existingSerialLines - 1; rmS >= 0; rmS--) {
                            inventoryDetail.removeLine({ sublistId: 'inventoryassignment', line: rmS });
                        }

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
                } else {
                    // Item BUKAN serialized/lot, tapi bisa saja tetap wajib
                    // Inventory Detail karena fitur "Multiple Inventory Statuses"
                    // aktif untuk item ini (kolom "From Status"/"To Status" di UI,
                    // bukan serial/lot number). Kalau tidak diisi, NetSuite nolak
                    // commitLine dengan "Please configure the inventory detail
                    // for this line." - jadi kita isi 1 baris assignment untuk
                    // seluruh qty, pakai Inventory Status dari payload kalau ada.
                    var needsInventoryDetail = transfer.getCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId  : 'inventorydetailreq'
                    });

                    if (needsInventoryDetail) {
                        try {
                            var statusDetail = transfer.getCurrentSublistSubrecord({
                                sublistId: 'inventory',
                                fieldId  : 'inventorydetail'
                            });

                            // Hapus baris default yang mungkin sudah ditarik otomatis oleh
                            // NetSuite pas subrecord ini pertama kali diakses (item dengan
                            // fitur Multiple Inventory Statuses sering auto-populate 1 baris
                            // default), biar tidak dobel/bentrok sama baris yang kita isi manual.
                            var existingStatusLines = statusDetail.getLineCount({ sublistId: 'inventoryassignment' });
                            for (var rmSt = existingStatusLines - 1; rmSt >= 0; rmSt--) {
                                statusDetail.removeLine({ sublistId: 'inventoryassignment', line: rmSt });
                            }

                            statusDetail.selectNewLine({ sublistId: 'inventoryassignment' });

                            statusDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId  : 'quantity',
                                value    : qty
                            });

                            // Inventory Status - butuh DUA field terpisah (dikonfirmasi
                            // dari inspect element popup Inventory Detail):
                            //   - 'inventorystatus'   -> "From Status" (wajib diisi,
                            //     NetSuite nolak commitLine kalau kosong)
                            //   - 'toinventorystatus' -> "To Status"
                            // Default fallback: 1 ("Good") - sesuaikan kalau item
                            // punya inventory status lain di akun ini.
                            var fromStatus = lineData.inventorystatus || lineData.fromstatus || 1;
                            var toStatus   = lineData.toinventorystatus || lineData.tostatus || fromStatus;

                            statusDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId  : 'inventorystatus',
                                value    : fromStatus
                            });

                            statusDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId  : 'toinventorystatus',
                                value    : toStatus
                            });

                            statusDetail.commitLine({ sublistId: 'inventoryassignment' });
                        } catch (invStatusErr) {
                            throw new Error('Gagal set inventory detail (status) baris ' + (l + 1) + ': ' + invStatusErr.message);
                        }
                    }
                }

                transfer.commitLine({ sublistId: 'inventory' });
            }

            } // end if (body.lines && body.lines.length > 0)

            // =========================
            // 🔥 SAVE — langsung pindah
            // =========================
            var newId = transfer.save({
                enableSourcing      : true,
                ignoreMandatoryFields: false
            });

            // Ambil Document Number (tranid) setelah save
            var documentNumber = null;
            try {
                documentNumber = search.lookupFields({
                    type   : search.Type.INVENTORY_TRANSFER,
                    id     : newId,
                    columns: ['tranid']
                }).tranid || null;
            } catch (lookupErr) {
                log.error({
                    title  : 'Lookup tranid Inventory Transfer gagal',
                    details: 'trxId ' + newId + ': ' + lookupErr.message
                });
            }

            return {
                status              : 'success',
                message             : isUpdate ? 'Inventory Transfer berhasil diupdate' : 'Inventory Transfer berhasil dibuat',
                inventory_transfer_id: newId,
                document_number     : documentNumber,
                from_location       : fromLocationId || null,
                to_location         : toLocationId || null
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
