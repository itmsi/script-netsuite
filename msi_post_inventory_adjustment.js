/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Membuat Inventory Adjustment menggunakan ME - Inventory Adjustment Form
 *
 * POST body:
 {
   "ccustomform": 112,
   "subsidiary": 1,                   // Internal ID Subsidiary (wajib)
   "account": 128,                    // Internal ID Adjustment Account (wajib)
   "department": 103,                  // Internal ID Department (wajib)
   "class"     : 3,                   // Internal ID Class / Classification (wajib jika form mewajibkan)
   "adjlocation": 214,                 // Internal ID Adjustment Location - header (wajib)
//    "trandate": "30-03-2026",          // Tanggal transaksi (opsional, default: hari ini)
//    "postingperiod": 24,              // Internal ID Posting Period (opsional)
   "memo": "Penyesuaian stok",        // Memo header (opsional)
   "customer": 38,                    // Internal ID Customer (opsional)
   "custbody_me_description": "Keterangan header",          // ME - Description header (opsional)
   "custbody_me_inv_customer": 38,                    // Internal ID Customer / ME-Customer (opsional)
   "custbody_me_purchase_order_number": 5278,     // ME - Purchase Order Number header (opsional)
//    "custbody_msi_cycle_count_cumber": 5278,  // MSI Cycle Count Number (opsional)
   "custbody_me_opening_balance": true,          // ME - Opening Balance, checkbox true/false (opsional)
   "lines": [                         // Array item yang akan disesuaikan (wajib, minimal 1)
     {
       "item": 26612,                   // Internal ID item (wajib)
       "location": 214,                 // Internal ID lokasi ppostingperioder baris (wajib)
       "quantity": 10,               // Qty penyesuaian: positif=tambah, negatif=kurang (wajib jika tidak pakai serials)
       "unit_cost": 150000,           // Proposed Unit Cost (opsional)
       "department": 103,              // Department per baris (opsional, override header)
       "class"     : 3,              // Class per baris (opsional, override header)
    //    "custcol_me_purchase_number_line": "PO-001",    // Purchase Number (Line) (opsional)
       "memo": "Catatan baris",       // Memo per baris (opsional)
       "serials": ["SN001", "SN002"]  // Serial numbers (opsional, untuk item serialized)
     }
   ]
 }
 */

define(['N/record', 'N/format','N/runtime', 'N/workflow', 'N/search'], (record, format, runtime, workflow, search) => {

  // Ambil lastpurchaseprice untuk banyak item sekaligus → { itemId: price }
    const getLastPurchasePrices = (itemIds) => {
        const result = {};
        const ids = [...new Set(itemIds.filter(Boolean).map(String))];
        if (ids.length === 0) return result;

        search.create({
            type: search.Type.ITEM,
            filters: [['internalid', 'anyof', ids]],
            columns: ['lastpurchaseprice']
        }).run().each((res) => {
            const price = res.getValue({ name: 'lastpurchaseprice' });
            result[res.id] = (price !== '' && price !== null) ? parseFloat(price) : null;
            return true;
        });
        return result;
    };

    const post = (body) => {

        try {

            // ── Validasi field wajib ──────────────────────────────────────────
            if (!body.subsidiary) {
                return { status: 'error', message: '"subsidiary" wajib diisi' };
            }
            if (!body.account) {
                return { status: 'error', message: '"account" (Adjustment Account) wajib diisi' };
            }
            if (!body.adjlocation) {
                return { status: 'error', message: '"adjlocation" (Adjustment Location) wajib diisi' };
            }
            if (!body.department) {
                return { status: 'error', message: '"department" wajib diisi' };
            }
            if (!body.class) {
                return { status: 'error', message: '"class" (Classification) wajib diisi' };
            }
            if (!body.lines || !Array.isArray(body.lines) || body.lines.length === 0) {
                return { status: 'error', message: '"lines" wajib diisi dan tidak boleh kosong' };
            }

            // ── Buat record Inventory Adjustment ─────────────────────────────
            let invAdj = record.create({
                type: record.Type.INVENTORY_ADJUSTMENT,
                isDynamic: true
            });

            // ── Header Fields ─────────────────────────────────────────────────
            // Custom Form (opsional — cari ID-nya di Setup > Customization > Transaction Forms)
            if (body.customform) {
                invAdj.setValue({ fieldId: 'customform', value: body.customform });
            }
            invAdj.setValue({ fieldId: 'subsidiary', value: body.subsidiary });
            invAdj.setValue({ fieldId: 'account', value: body.account });
            invAdj.setValue({ fieldId: 'adjlocation', value: body.adjlocation });
            invAdj.setValue({ fieldId: 'department', value: body.department });
            invAdj.setValue({ fieldId: 'class', value: body.class });

            if (body.trandate) {
                // Format trandate: "DD-MM-YYYY" atau "DD/MM/YYYY"
                const [day, month, year] = body.trandate.split(/[-\/]/).map(Number);
                const parsedDate = new Date(year, month - 1, day);
                invAdj.setValue({ fieldId: 'trandate', value: parsedDate });
            }

            if (body.postingperiod) {
                invAdj.setValue({ fieldId: 'postingperiod', value: body.postingperiod });
            }

            if (body.memo !== undefined) {
                invAdj.setValue({ fieldId: 'memo', value: body.memo });
            }

            // Customer
            if (body.customer) {
                invAdj.setValue({ fieldId: 'customer', value: body.customer });
            }

            // Custom header: ME - Customer
            if (body.custbody_me_inv_customer) {
                invAdj.setValue({ fieldId: 'custbody_me_inv_customer', value: body.custbody_me_inv_customer });
            }

            // Custom header: ME - Purchase Order Number
            if (body.custbody_me_purchase_order_number !== undefined) {
                invAdj.setValue({ fieldId: 'custbody_me_purchase_order_number', value: body.custbody_me_purchase_order_number });
            }

            // Custom header: ME - Description
            if (body.custbody_me_description !== undefined) {
                invAdj.setValue({ fieldId: 'custbody_me_description', value: body.custbody_me_description });
            }

            // Custom header: MSI Cycle Count Number
            if (body.custbody_msi_cycle_count_cumber !== undefined) {
                invAdj.setText({ fieldId: 'custbody_msi_cycle_count_cumber', text: String(body.custbody_msi_cycle_count_cumber) });
            }

            // Custom header: ME - Opening Balance (checkbox)
            if (body.custbody_me_opening_balance !== undefined) {
                invAdj.setValue({ fieldId: 'custbody_me_opening_balance', value: body.custbody_me_opening_balance });
            }

            const lastPrices = getLastPurchasePrices(body.lines.map(l => l.item));
            // ── Proses setiap baris ───────────────────────────────────────────
            body.lines.forEach((lineData, idx) => {

                if (!lineData.item) {
                    throw new Error(`Baris ke-${idx}: "item" wajib diisi`);
                }
                if (!lineData.location && lineData.location !== 0) {
                    throw new Error(`Baris ke-${idx}: "location" wajib diisi`);
                }

                // quantity wajib diisi jika tidak pakai serials
                if ((lineData.quantity === undefined || lineData.quantity === null) &&
                    (!lineData.serials || lineData.serials.length === 0)) {
                    throw new Error(`Baris ke-${idx}: "quantity" wajib diisi`);
                }

                invAdj.selectNewLine({ sublistId: 'inventory' });

                invAdj.setCurrentSublistValue({
                    sublistId: 'inventory',
                    fieldId: 'item',
                    value: lineData.item
                });

                invAdj.setCurrentSublistValue({
                    sublistId: 'inventory',
                    fieldId: 'location',
                    value: lineData.location
                });

                // Set quantity adjustment
                if (lineData.quantity !== undefined && lineData.quantity !== null) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'adjustqtyby',
                        value: 0
                    });

                    log.debug("qtyLine",lineData.quantity );
                    const numQty = parseInt(lineData.quantity, 10); 
                  log.debug("qtyLineInt",numQty );
                    // Set juga ke custom kolom Proposed Qty
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'custcol_me_proposed_qty',
                        value: lineData.quantity
                    });
                }

                // Proposed Unit Cost
                // Unit Cost: pakai unit_cost dari body, kalau kosong pakai lastpurchaseprice item
                const unitCost = (lineData.unit_cost !== undefined && lineData.unit_cost !== null && lineData.unit_cost !== '')
                    ? lineData.unit_cost
                    : lastPrices[String(lineData.item)];

                log.debug('unitCost line ' + idx, { item: lineData.item, unitCost });

                if (unitCost !== undefined && unitCost !== null && !isNaN(unitCost)) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'custcol_me_proposed_unit_cost',
                        value: unitCost
                    });
                }

                // Department per baris (opsional, kalau berbeda dari header)
                if (lineData.department !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'department',
                        value: lineData.department
                    });
                }

                // Class per baris — WAJIB diisi, fallback ke header class
                invAdj.setCurrentSublistValue({
                    sublistId: 'inventory',
                    fieldId: 'class',
                    value: lineData.class !== undefined ? lineData.class : body.class
                });

                // Custom kolom: ME \ Description
                if (lineData.me_description !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'custcol_me_description',
                        value: lineData.me_description
                    });
                }

                // Custom kolom: Purchase Number (Line)
                if (lineData.custcol_me_purchase_number_line !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'custcol_me_purchase_number_line',
                        value: lineData.custcol_me_purchase_number_line
                    });
                }

                // Memo per baris
                if (lineData.memo !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'memo',
                        value: lineData.memo
                    });
                }

                // ── Serial Numbers (untuk item Serialized Inventory) ──────────
                if (lineData.serials && Array.isArray(lineData.serials) && lineData.serials.length > 0) {

                    // Override qty sesuai jumlah serial
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId: 'adjustqtyby',
                        value: lineData.serials.length
                    });

                    //Coba set inventorydetail — hanya berhasil kalau item support serialized/lot tracking
                    try {
                        let inventoryDetail = invAdj.getCurrentSublistSubrecord({
                            sublistId: 'inventory',
                            fieldId: 'inventorydetail'
                        });

                        // Hapus baris lama jika ada
                        let existingLines = inventoryDetail.getLineCount({ sublistId: 'inventoryassignment' });
                        for (let j = existingLines - 1; j >= 0; j--) {
                            inventoryDetail.removeLine({ sublistId: 'inventoryassignment', line: j });
                        }

                        // Tambah setiap serial number
                        lineData.serials.forEach((sn) => {
                            inventoryDetail.selectNewLine({ sublistId: 'inventoryassignment' });

                            inventoryDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'receiptinventorynumber',
                                value: sn
                            });

                            inventoryDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'quantity',
                                value: 1
                            });

                            inventoryDetail.commitLine({ sublistId: 'inventoryassignment' });
                        });

                    } catch (invErr) {
                        // Item tidak support serialized tracking → abaikan, qty sudah ter-set di atas
                        // "You cannot create an inventory detail for this item" → non-serialized item
                    }
                }

                invAdj.commitLine({ sublistId: 'inventory' });
            });

            // ── Simpan record ─────────────────────────────────────────────────
            let newId = invAdj.save({
                enableSourcing: true,
                ignoreMandatoryFields: false
            });

            //--Create Note - use field Memo 
            var noteRec = record.create({
                    type: 'note',
                    isDynamic: true
                });

                noteRec.setValue({
                    fieldId: 'title',
                    value: body.noteTitle || 'API Note'
                });

                noteRec.setValue({
                    fieldId: 'note',
                    value: body.note || body.memo
                });

                noteRec.setValue({
                    fieldId: 'transaction',
                    value: newId 
                });

                noteRec.setValue({
                    fieldId: 'author',
                    value: runtime.getCurrentUser().id
                });

                noteId = noteRec.save();

                //Next Workflow
               try {
                var recType = record.Type.INVENTORY_ADJUSTMENT;
                var approvalWorkflowId
                workflow.trigger({
                    recordId: newId,
                    recordType: recType,
                    workflowId: 'customworkflow_me_workflow_approvals_dl',
                    actionId: 'workflowaction_me_init_approve'
                });

                try {
                    record.load({ type: recType, id: newId, isDynamic: false });
                } catch (loadErr) {
                    log.error({
                        title: 'Submit Approval IA - gagal force record.load setelah trigger',
                        details: 'trxId ' + newId + ': ' + loadErr.message
                    });
                }
            } catch (e) {
                log.error({
                    title: 'Submit Approval IA error',
                    details: 'trxId ' + newId + ': ' + e.message
                });
            }

            return {
                status: 'success',
                message: 'Inventory Adjustment berhasil dibuat',
                inventory_adjustment_id: newId
            };

        } catch (error) {
            return {
                status: 'error',
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }
    };

    return { post };

});
