/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Membuat Inventory Adjustment menggunakan ME - Inventory Adjustment Form
 *
 * POST body:
 * {
 *   "subsidiary": 1,                   // Internal ID Subsidiary (wajib)
 *   "account": 123,                    // Internal ID Adjustment Account (wajib)
 *   "adj_location": 5,                 // Internal ID Adjustment Location - header (wajib)
 *   "department": 10,                  // Internal ID Department (wajib)
 *   "class"     : 3,                   // Internal ID Class / Classification (wajib jika form mewajibkan)
 *   "trandate": "2026-03-13",          // Tanggal transaksi (opsional, default: hari ini)
 *   "posting_period": 20,              // Internal ID Posting Period (opsional)
 *   "memo": "Penyesuaian stok",        // Memo header (opsional)
 *   "customer": 11,                    // Internal ID Customer / ME-Customer (opsional)
 *   "me_po_number": "PO-2026-001",     // ME - Purchase Order Number header (opsional)
 *   "customform": 123,                  // Internal ID Custom Form (opsional, cek di Setup > Customization > Transaction Forms)
 *   "lines": [                         // Array item yang akan disesuaikan (wajib, minimal 1)
 *     {
 *       "item": 456,                   // Internal ID item (wajib)
 *       "location": 5,                 // Internal ID lokasi per baris (wajib)
 *       "quantity": 10,               // Qty penyesuaian: positif=tambah, negatif=kurang (wajib jika tidak pakai serials)
 *       "unit_cost": 150000,           // Proposed Unit Cost (opsional)
 *       "department": 10,              // Department per baris (opsional, override header)
 *       "class"     : 3,              // Class per baris (opsional, override header)
 *       "me_description": "Keterangan",// ME \ Description per baris (opsional)
 *       "po_number_line": "PO-001",    // Purchase Number (Line) (opsional)
 *       "memo": "Catatan baris",       // Memo per baris (opsional)
 *       "serials": ["SN001", "SN002"]  // Serial numbers (opsional, untuk item serialized)
 *     }
 *   ]
 * }
 */

define(['N/record', 'N/format'], (record, format) => {

    const post = (body) => {

        try {

            // ── Validasi field wajib ──────────────────────────────────────────
            if (!body.subsidiary) {
                return { status: 'error', message: '"subsidiary" wajib diisi' };
            }
            if (!body.account) {
                return { status: 'error', message: '"account" (Adjustment Account) wajib diisi' };
            }
            if (!body.adj_location) {
                return { status: 'error', message: '"adj_location" (Adjustment Location) wajib diisi' };
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
                type:      record.Type.INVENTORY_ADJUSTMENT,
                isDynamic: true
            });

            // ── Header Fields ─────────────────────────────────────────────────
            // Custom Form (opsional — cari ID-nya di Setup > Customization > Transaction Forms)
            if (body.customform) {
                invAdj.setValue({ fieldId: 'customform', value: body.customform });
            }
            invAdj.setValue({ fieldId: 'subsidiary',   value: body.subsidiary });
            invAdj.setValue({ fieldId: 'account',      value: body.account });
            invAdj.setValue({ fieldId: 'adjlocation',  value: body.adj_location });
            invAdj.setValue({ fieldId: 'department',   value: body.department });
            invAdj.setValue({ fieldId: 'class',        value: body.class });

            if (body.trandate) {
                let parsedDate = format.parse({
                    value: body.trandate,
                    type:  format.Type.DATE
                });
                invAdj.setValue({ fieldId: 'trandate', value: parsedDate });
            }

            if (body.posting_period) {
                invAdj.setValue({ fieldId: 'postingperiod', value: body.posting_period });
            }

            if (body.memo !== undefined) {
                invAdj.setValue({ fieldId: 'memo', value: body.memo });
            }

            // Custom header: ME - Customer
            if (body.customer) {
                invAdj.setValue({ fieldId: 'custbody_me_customer', value: body.customer });
            }

            // Custom header: ME - Purchase Order Number
            if (body.me_po_number !== undefined) {
                invAdj.setValue({ fieldId: 'custbody_me_po_number', value: body.me_po_number });
            }

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
                    fieldId:   'item',
                    value:     lineData.item
                });

                invAdj.setCurrentSublistValue({
                    sublistId: 'inventory',
                    fieldId:   'location',
                    value:     lineData.location
                });

                // Set quantity adjustment
                if (lineData.quantity !== undefined && lineData.quantity !== null) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId:   'adjustqtyby',
                        value:     lineData.quantity
                    });
                }

                // Proposed Unit Cost
                if (lineData.unit_cost !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId:   'unitcost',
                        value:     lineData.unit_cost
                    });
                }

                // Department per baris (opsional, kalau berbeda dari header)
                if (lineData.department !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId:   'department',
                        value:     lineData.department
                    });
                }

                // Class per baris — WAJIB diisi, fallback ke header class
                invAdj.setCurrentSublistValue({
                    sublistId: 'inventory',
                    fieldId:   'class',
                    value:     lineData.class !== undefined ? lineData.class : body.class
                });

                // Custom kolom: ME \ Description
                if (lineData.me_description !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId:   'custcol_me_description',
                        value:     lineData.me_description
                    });
                }

                // Custom kolom: Purchase Number (Line)
                if (lineData.po_number_line !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId:   'custcol_me_po_number_line',
                        value:     lineData.po_number_line
                    });
                }

                // Memo per baris
                if (lineData.memo !== undefined) {
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId:   'memo',
                        value:     lineData.memo
                    });
                }

                // ── Serial Numbers (untuk item Serialized Inventory) ──────────
                if (lineData.serials && Array.isArray(lineData.serials) && lineData.serials.length > 0) {

                    // Override qty sesuai jumlah serial
                    invAdj.setCurrentSublistValue({
                        sublistId: 'inventory',
                        fieldId:   'adjustqtyby',
                        value:     lineData.serials.length
                    });

                    // Coba set inventorydetail — hanya berhasil kalau item support serialized/lot tracking
                    try {
                        let inventoryDetail = invAdj.getCurrentSublistSubrecord({
                            sublistId: 'inventory',
                            fieldId:   'inventorydetail'
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
                                fieldId:   'receiptinventorynumber',
                                value:     sn
                            });

                            inventoryDetail.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId:   'quantity',
                                value:     1
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
                enableSourcing:        true,
                ignoreMandatoryFields: false
            });

            return {
                status:                    'success',
                message:                   'Inventory Adjustment berhasil dibuat',
                inventory_adjustment_id:   newId
            };

        } catch (error) {
            return {
                status:  'error',
                name:    error.name,
                message: error.message,
                stack:   error.stack
            };
        }
    };

    return { post };

});
