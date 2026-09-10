/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Item Receipt (header + lines) dengan pagination & filters menggunakan N/search
 *
 * POST body:
 {
   "page":       1,               // Halaman (default: 1)
   "page_size":  20,              // Jumlah data per halaman (default: 20)
   "sort_by":    "internalid",    // Field untuk sorting (default: "internalid")
   "sort_order": "DESC",          // ASC / DESC (default: "DESC")
   "filters": {
     "receipt_ids": [100, 101],   // Filter by ID (opsional)
     "tranid": "IR-2026-001",     // Filter by nomor Item Receipt (opsional)
     "createdfrom_text": "PO-",   // Filter by nomor dokumen asal (opsional)
     "createdfrom": 5157,         // Filter by ID dokumen asal (opsional)
     "vendor_id": 10,             // Filter by vendor ID (opsional)
     "source_type": "purchase_order", // "purchase_order" | "transfer_order" | "customer_return" | "inbound_shipment" (opsional)
     "lastmodified": "2026-03-31T23:59:00+07:00" // Filter tanggal diubah (opsional)
   }
 }
 */

define(['N/search', 'N/record', 'N/log', 'N/query'], (search, record, log, query) => {
    function formatToISO(dateStr) {
        if (!dateStr) return null;

        // =========================
        // 1. FORMAT: DD/MM/YYYY HH:mm AM/PM
        // =========================
        var fullRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
        var m1 = dateStr.match(fullRegex);

        if (m1) {
            var day = parseInt(m1[1]);
            var month = parseInt(m1[2]);
            var year = parseInt(m1[3]);
            var hour = parseInt(m1[4]);
            var minute = parseInt(m1[5]);
            var ampm = m1[6].toUpperCase();

            if (ampm === "PM" && hour !== 12) hour += 12;
            if (ampm === "AM" && hour === 12) hour = 0;

            return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00+07:00`;
        }

        // =========================
        // 2. FORMAT: DD/MM/YYYY (tanpa jam)
        // =========================
        var shortRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        var m2 = dateStr.match(shortRegex);

        if (m2) {
            var day = parseInt(m2[1]);
            var month = parseInt(m2[2]);
            var year = parseInt(m2[3]);

            return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T00:00:00+07:00`;
        }

        // =========================
        // 3. FALLBACK
        // =========================
        var d = new Date(dateStr);
        if (isNaN(d)) return dateStr;

        return d.toISOString();
    }

    const post = (body) => {
        try {
            body = body || {};

            let page      = body.page      || 1;
            let pageSize  = body.page_size || 20;
            let sortBy    = body.sort_by    || 'internalid';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? false : true; // DESC is default (true)

            // Mapping sort_by
            const sortMap = {
                'internalid': 'internalid',
                'id': 'internalid',
                'tranid': 'tranid',
                'trandate': 'trandate',
                'lastmodified': 'lastmodifieddate'
            };
            let searchSortCol = sortMap[sortBy] || 'internalid';

            let filtersBody = body.filters || {};

            // ── Bangun filter search ──────────────────────────────────────────
            let searchFilters = [
                ['mainline', 'is', 'T'],
                'AND',
                ['type', 'anyof', 'ItemRcpt']
            ];

            const sourceTypeMap = {
                'purchase_order':   'PurchOrd',
                'transfer_order':   'TrnfrOrd',
                'customer_return':  'RtnAuth',
                'inbound_shipment': 'InbShip'
            };
            const sourceTypeMapReverse = {
                'PurchOrd': 'purchase_order',
                'TrnfrOrd': 'transfer_order',
                'RtnAuth':  'customer_return',
                'InbShip':  'inbound_shipment'
            };

            if (filtersBody.source_type) {
                let sourceTypeId = sourceTypeMap[filtersBody.source_type];
                if (!sourceTypeId) {
                    throw new Error("filters.source_type tidak valid. Gunakan: 'purchase_order', 'transfer_order', 'customer_return', atau 'inbound_shipment'.");
                }
                searchFilters.push('AND', ['createdfrom.type', 'anyof', sourceTypeId]);
            }

            if (filtersBody.receipt_ids && Array.isArray(filtersBody.receipt_ids) && filtersBody.receipt_ids.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.receipt_ids]);
            }

            if (filtersBody.internalid && Array.isArray(filtersBody.internalid) && filtersBody.internalid.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.internalid]);
            }

            if (filtersBody.tranid) {
                searchFilters.push('AND', ['tranid', 'contains', filtersBody.tranid.trim()]);
            }

            if (filtersBody.createdfrom) {
                searchFilters.push('AND', ['createdfrom', 'anyof', filtersBody.createdfrom]);
            }

            if (filtersBody.createdfrom_text) {
                searchFilters.push('AND', ['createdfrom.tranid', 'contains', filtersBody.createdfrom_text.trim()]);
            }

            if (filtersBody.vendor_id) {
                searchFilters.push('AND', ['entity', 'anyof', filtersBody.vendor_id]);
            }

            if (filtersBody.lastmodified) {
                var lmMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(filtersBody.lastmodified));
                if (!lmMatch) {
                    throw new Error("filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + filtersBody.lastmodified + "'.");
                }

                var lmSqlDate = lmMatch[1] + '-' + lmMatch[2] + '-' + lmMatch[3] + ' ' +
                    lmMatch[4] + ':' + lmMatch[5] + ':' + (lmMatch[6] || '00');

                var lmFormula = "formulanumeric: CASE WHEN {lastmodifieddate} >= TO_DATE('" + lmSqlDate + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END";
                searchFilters.push('AND', [lmFormula, 'equalto', '1']);
            }

            // ── Buat Search Header ─────────────────────────────────────────────
            let headerSearch = search.create({
                type: search.Type.ITEM_RECEIPT,
                filters: searchFilters,
                columns: [
                    search.createColumn({ name: searchSortCol, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }),
                    'internalid', 'tranid', 'trandate', 'status', 'memo', 'entity',
                    'createdfrom', 'lastmodifieddate', 'datecreated',
                    'location', 'transferlocation', 'subsidiarynohierarchy', 'department', 'class',
                    'postingperiod', 'incoterm', 'currency', 'exchangerate',
                    search.createColumn({ name: 'type', join: 'createdfrom' }), 
                    'createdby'
                ]
            });

            // ── Eksekusi Search Berhalaman ────────────────────────────────────
            let pagedData = headerSearch.runPaged({ pageSize: pageSize });
            let totalRecords = pagedData.count;
            let totalPages   = pagedData.pageRanges.length;

            if (totalRecords === 0 || page > totalPages) {
                return {
                    status:        'success',
                    page,
                    page_size:     pageSize,
                    total_records: totalRecords,
                    total_pages:   totalPages,
                    data:          []
                };
            }

            let searchPage = pagedData.fetch({ index: page - 1 });
            let pagedHeaders = [];
            let foundReceiptIds = [];

            searchPage.data.forEach(res => {
                foundReceiptIds.push(res.id);
                pagedHeaders.push({
                    receipt_id:           res.id,
                    tranid:               res.getValue('tranid'),
                    trandate:             res.getValue('trandate'),
                    status:               res.getValue('status'),
                    status_display:       res.getText('status'),
                    memo:                 res.getValue('memo'),
                    vendor_id:            res.getValue('entity'),
                    vendor_name:          res.getText('entity'),
                    createdfrom:          res.getValue('createdfrom'),
                    createdfrom_display:  res.getText('createdfrom'),
                    source_type:          sourceTypeMapReverse[res.getValue({ name: 'type', join: 'createdfrom' })] || null,
                    source_type_display:  res.getText({ name: 'type', join: 'createdfrom' }),
                    subsidiary:           res.getValue('subsidiarynohierarchy'),
                    subsidiary_display:   res.getText('subsidiarynohierarchy'),
                    location:             res.getValue('location'),
                    location_display:     res.getText('location'),
                    transferlocation:         res.getValue('transferlocation'),
                    transferlocation_display: res.getText('transferlocation'),
                    department:           res.getValue('department'),
                    department_display:   res.getText('department'),
                    class:                res.getValue('class'),
                    class_display:        res.getText('class'),
                    postingperiod:        res.getText('postingperiod'),
                    incoterm_id:          res.getValue('incoterm'),
                    incoterm_name:        res.getText('incoterm') || null,
                    currency:             res.getValue('currency'),
                    currency_display:     res.getText('currency'),
                    exchangerate:         res.getValue('exchangerate'),
                    last_modified:        formatToISO(res.getValue('lastmodifieddate')),
                    datecreated:          formatToISO(res.getValue('datecreated')),
                    created_by_id: res.getValue('createdby') ? Number(res.getValue('createdby')) : null,
                    created_by_name: res.getText('createdby') || null,
                });
            });
            
            let descriptionMap = {};

            foundReceiptIds.forEach(receiptId => {

                let rec = record.load({
                    type: record.Type.ITEM_RECEIPT,
                    id: receiptId
                });

                let lineCount = rec.getLineCount({
                    sublistId: 'item'
                });

                descriptionMap[receiptId] = {};

                for (let i = 0; i < lineCount; i++) {

                    let lineNum = rec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'line',
                        line: i
                    });

                    let desc = rec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'description',
                        line: i
                    });

                    descriptionMap[receiptId][lineNum] = desc;
                }
            });

            // ── Search Line Items ─────────────────────────────────────────────
            let linesByReceipt = {};
            if (foundReceiptIds.length > 0) {
                let lineSearch = search.create({
                    type: search.Type.ITEM_RECEIPT,
                    filters: [
                        ['internalid', 'anyof', foundReceiptIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F'],
                        'AND',
                        ['shipping', 'is', 'F'],
                        'AND',
                        ['item', 'noneof', '@NONE@']
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                        search.createColumn({ name: 'line', sort: search.Sort.ASC }),
                        'lineuniquekey', 'item', 'itemtype', 'quantity', 'rate', 'amount', 'memo',
                        'location', 'department', 'class', 'restock',
                        'custcol_me_landed_cost',
                        search.createColumn({ name: 'inventorynumber', join: 'inventoryDetail' }), search.createColumn({ name: 'displayname', join: 'item' })
                    ]
                });

                lineSearch.run().each(res => {
                    let receiptId = res.getValue('internalid');
                    let lineNum = res.getValue('line');
                    if (!linesByReceipt[receiptId]) linesByReceipt[receiptId] = [];

                    linesByReceipt[receiptId].push({
                        line:               res.getValue('line'),
                        line_id:            res.getValue('lineuniquekey'),
                        item:               res.getValue('item'),
                        item_display:       res.getText('item'),
                        item_displayname:   res.getValue({ name: 'displayname', join: 'item' }),
                        itemtype:           res.getValue('itemtype'),
                        description:        descriptionMap[receiptId] && descriptionMap[receiptId][lineNum] ? descriptionMap[receiptId][lineNum] : '',
                        quantity:           res.getValue('quantity'),
                        rate:               res.getValue('rate'),
                        amount:             res.getValue('amount'),
                        memo:               res.getValue('memo'),
                        // on_hand diisi belakangan via inventory lookup per
                        // (item + lokasi) — sama seperti msi_get_item_fulfillments.js.
                        on_hand:            null,
                        location:           res.getValue('location'),
                        location_display:   res.getText('location'),
                        department:         res.getValue('department'),
                        department_display: res.getText('department'),
                        class:              res.getValue('class'),
                        class_display:      res.getText('class'),
                        restock:            res.getValue('restock'),
                        landed_cost:        res.getValue('custcol_me_landed_cost'),
                        // currency & project segmentation diisi belakangan
                        // (lihat blok penggabungan header+lines).
                        currency:           null,
                        currency_display:   null,
                        cseg_msi_pro_segmen: null,
                        cseg_msi_pro_segmen_display: null,
                        inventorydetail:    res.getText({ name: 'inventorynumber', join: 'inventoryDetail' })
                    });
                    return true;
                });
            }

            // ── Ambil Data Inbound Shipment via SuiteQL ──────────────────────
            // "inboundshipment" bukan search column yang valid di Item Receipt search
            // (SSS_INVALID_SRCH_COL) maupun field record.load biasa — pola query-nya
            // disamain persis seperti msi_get_purchase_orders.js: join InboundShipmentItem
            // ke PO (via createdfrom si receipt, yang levelnya header/PO, bukan per-line).
            let shipmentByPoId = {};
            let poIdsForShipment = pagedHeaders
                .map(h => h.createdfrom)
                .filter(id => id && /^\d+$/.test(String(id)));
            poIdsForShipment = poIdsForShipment.filter((id, idx) => poIdsForShipment.indexOf(id) === idx);

            if (poIdsForShipment.length > 0) {
                try {
                    let sqlShipment = `
                        SELECT
                            isi.purchaseordertransaction as po_id,
                            BUILTIN.DF(isi.inboundshipment) as shipment_number,
                            isi.inboundshipment as shipment_id
                        FROM
                            InboundShipmentItem isi
                        WHERE
                            isi.purchaseordertransaction IN (${poIdsForShipment.join(',')})
                    `;
                    let shipmentResults = query.runSuiteQL({ query: sqlShipment }).asMappedResults();
                    shipmentResults.forEach(r => {
                        shipmentByPoId[r.po_id] = {
                            id: r.shipment_id,
                            number: r.shipment_number
                        };
                    });
                } catch (e) {
                    log.error('Inbound Shipment Query Error', e.message);
                }
            }

            // ── On Hand per Line (qty di lokasi baris) ──────────────────────
            // Pola sama seperti msi_get_item_fulfillments.js: on hand cuma relevan
            // untuk item inventory (InvtPart/Serialized/Lot) dan bersifat per-lokasi.
            let onHandByItemLoc = {};
            if (Object.keys(linesByReceipt).length > 0) {
                const itemTypeToSearchType = (t) => {
                    switch (t) {
                        case 'InvtPart':   return search.Type.INVENTORY_ITEM;
                        case 'Serialized': return search.Type.SERIALIZED_INVENTORY_ITEM;
                        case 'Lot':        return search.Type.LOT_NUMBERED_INVENTORY_ITEM;
                        default:           return null;
                    }
                };

                const typeItems = {};
                Object.keys(linesByReceipt).forEach(receiptId => {
                    linesByReceipt[receiptId].forEach(l => {
                        const st = itemTypeToSearchType(l.itemtype);
                        if (!st || !l.item || l.location === null || l.location === undefined || l.location === '') return;
                        if (!typeItems[st]) typeItems[st] = { items: {}, locations: {} };
                        typeItems[st].items[String(l.item)] = true;
                        typeItems[st].locations[String(l.location)] = true;
                    });
                });

                Object.keys(typeItems).forEach(st => {
                    const itemIds = Object.keys(typeItems[st].items);
                    const locationIds = Object.keys(typeItems[st].locations);
                    if (itemIds.length === 0 || locationIds.length === 0) return;
                    try {
                        const invSearch = search.create({
                            type: st,
                            filters: [
                                ['internalid', 'anyof', itemIds],
                                'AND',
                                ['inventorylocation', 'anyof', locationIds]
                            ],
                            columns: [
                                search.createColumn({ name: 'internalid' }),
                                search.createColumn({ name: 'locationquantityonhand' }),
                                search.createColumn({ name: 'inventorylocation' })
                            ]
                        });
                        invSearch.run().each(r => {
                            const key = String(r.id) + '_' + String(r.getValue('inventorylocation'));
                            const oh = r.getValue('locationquantityonhand');
                            onHandByItemLoc[key] =
                                (oh !== null && oh !== undefined && oh !== '') ? Number(oh) : null;
                            return true;
                        });
                    } catch (e) {
                        log.error('On Hand Search Error (' + st + ')', e.message);
                    }
                });
            }

            // ── Custom Segment "Project Segmentation" per-line via SuiteQL ────
            // N/search (search.Type.ITEM_RECEIPT) tidak bisa resolve field custom
            // segment ini sebagai kolom biasa (selalu invalid) — pola sama seperti
            // msi_get_purchase_orders.js: query TransactionLine langsung via SuiteQL,
            // di-map per lineuniquekey.
            let lineSegmentMap = {};
            if (foundReceiptIds.length > 0) {
                try {
                    let sqlSegment = `
                        SELECT
                            tl.uniquekey as line_uniquekey,
                            tl.cseg_msi_pro_segmen as segment_id,
                            BUILTIN.DF(tl.cseg_msi_pro_segmen) as segment_name
                        FROM
                            TransactionLine tl
                        WHERE
                            tl.transaction IN (${foundReceiptIds.join(',')})
                            AND tl.mainline = 'F'
                    `;
                    let segmentResults = query.runSuiteQL({ query: sqlSegment }).asMappedResults();
                    segmentResults.forEach(r => {
                        lineSegmentMap[r.line_uniquekey] = {
                            id: r.segment_id,
                            name: r.segment_name
                        };
                    });
                } catch (e) {
                    log.error('Project Segmentation Query Error', e.message);
                }
            }

            // ── Search Custom Attach Files ────────────────────────────────────
            // Pola sama seperti msi_get_transfer_orders.js / msi_get_item_fulfillments.js
            let filesByReceipt = {};
            if (foundReceiptIds.length > 0) {
                try {
                    let idOrFilters = [];
                    foundReceiptIds.forEach((id, i) => {
                        if (i > 0) idOrFilters.push('OR');
                        idOrFilters.push(['custrecord_msi_transaction_id', 'is', String(id)]);
                    });

                    let fileSearch = search.create({
                        type: 'customrecord_msi_web_url_file',
                        filters: [
                            idOrFilters,
                            'AND',
                            ['isinactive', 'is', 'F']
                        ],
                        columns: [
                            'name',
                            'custrecord_msi_transaction_id',
                            'custrecord_msi_web_url',
                            'custrecord_msi_createdby_api_file'
                        ]
                    });

                    fileSearch.run().each(res => {
                        let receiptId = res.getValue('custrecord_msi_transaction_id');
                        if (!receiptId) return true;
                        if (!filesByReceipt[receiptId]) filesByReceipt[receiptId] = [];
                        filesByReceipt[receiptId].push({
                            id: res.id,
                            fileName: res.getValue('name'),
                            fileUrl: res.getValue('custrecord_msi_web_url'),
                            created_by_api: res.getValue('custrecord_msi_createdby_api_file')
                        });
                        return true;
                    });
                } catch (e) {
                    log.error('File Search Error', e.message);
                }
            }

            // ── Search User Notes ─────────────────────────────────────────────
            // Pola sama seperti msi_get_item_fulfillments.js
            let notesByReceipt = {};
            if (foundReceiptIds.length > 0) {
                let noteSearch = search.create({
                    type: 'note',
                    filters: [
                        search.createFilter({
                            name: 'internalid',
                            join: 'transaction',
                            operator: search.Operator.ANYOF,
                            values: foundReceiptIds
                        })
                    ],
                    columns: [
                        'internalid',
                        search.createColumn({ name: 'internalid', join: 'transaction' }),
                        'title', 'note', 'notedate', 'author', 'direction', 'notetype'
                    ]
                });

                let processedNoteIds = {};
                noteSearch.run().each(res => {
                    let noteRecordId = res.id;
                    if (processedNoteIds[noteRecordId]) return true;
                    processedNoteIds[noteRecordId] = true;

                    let receiptId = res.getValue({ name: 'internalid', join: 'transaction' });
                    if (!notesByReceipt[receiptId]) notesByReceipt[receiptId] = [];

                    notesByReceipt[receiptId].push({
                        title: res.getValue('title'),
                        note: res.getValue('note'),
                        date: res.getValue('notedate'),
                        author: res.getText('author'),
                        direction: res.getValue('direction'),
                        type: res.getText('notetype')
                    });
                    return true;
                });
            }

            // ── Gabungkan header + lines + files + notes ──────────────────────────
            let data = pagedHeaders.map(header => {
                let rawLines = linesByReceipt[header.receipt_id] || [];
                const isTransfer = header.source_type === 'transfer_order';

                // ── Ciutkan baris "phantom"/cermin bawaan NetSuite ─────────────
                // Item Receipt yang dibuat dari Transfer Order bisa menyimpan
                // 2 sub-row di transactionline untuk 1 baris item UI:
                //   +qty di lokasi TUJUAN (transferlocation) dan
                //   -qty di lokasi ASAL (location) — pola sama seperti
                //   msi_get_item_fulfillments.js / msi_get_transfer_orders.js.
                // Baris cermin selalu ber-qty NEGATIF. Dedupe aman:
                //   - grup mengandung baris negatif → collapse per |qty| unik,
                //     pilih SATU wakil (prefer qty positif → baris pertama);
                //   - grup semua positif → baris asli berbeda → pertahankan semua
                //     (kecuali khas TO: duplikat +q/+q tanpa baris negatif).
                // Untuk TO, lokasi sengaja diabaikan saat grouping karena baris
                // cermin negatif tercatat di lokasi asal yang berbeda.
                let lines = rawLines;
                if (lines.length > 1) {
                    const groupMap = {};
                    const groupOrder = [];
                    lines.forEach(l => {
                        const gk = isTransfer
                            ? [l.item, l.department, l.class].join('|')
                            : [l.item, l.location, l.department, l.class].join('|');
                        if (!groupMap[gk]) { groupMap[gk] = []; groupOrder.push(gk); }
                        groupMap[gk].push(l);
                    });

                    const collapsed = [];
                    groupOrder.forEach(gk => {
                        const group = groupMap[gk];
                        if (group.length === 1) { collapsed.push(group[0]); return; }

                        const negCount = group.filter(l => Number(l.quantity) < 0).length;
                        const absQtySet = {};
                        group.forEach(l => { absQtySet[Math.abs(Number(l.quantity))] = true; });
                        const duplicateAbs = Object.keys(absQtySet).length < group.length;

                        // Baris positif semua & bukan duplikat absolut khas TO →
                        // baris asli yang berbeda → pertahankan semua.
                        if (negCount === 0 && !(isTransfer && duplicateAbs)) {
                            group.forEach(l => collapsed.push(l));
                            return;
                        }

                        // Ada baris cermin/negatif (atau duplikat absolut TO):
                        // pilih SATU wakil per |qty| unik. Prefer qty positif
                        // (baris penerimaan di lokasi tujuan), lalu baris
                        // dengan nomor line terkecil.
                        const byAbs = {};
                        const absOrder = [];
                        group.forEach(l => {
                            const a = Math.abs(Number(l.quantity));
                            const prev = byAbs[a];
                            if (!prev) { byAbs[a] = l; absOrder.push(a); return; }
                            const prevQty = Number(prev.quantity) || 0;
                            const qty = Number(l.quantity) || 0;
                            let best = prev;
                            if (prevQty < 0 && qty > 0) best = l;          // l positif, prev negatif
                            else if (prevQty > 0 && qty < 0) best = prev; // prev positif, l negatif
                            else if (Number(l.line) < Number(prev.line)) best = l;
                            byAbs[a] = best;
                        });
                        absOrder.forEach(a => collapsed.push(byAbs[a]));
                    });

                    // Urutkan sesuai nomor line asli agar sesuai urutan UI
                    collapsed.sort((a, b) => Number(a.line) - Number(b.line));
                    lines = collapsed;

                    if (rawLines.length > 0 && lines.length !== rawLines.length) {
                        log.audit('IR Line Dedupe', `IR ${header.receipt_id} (${header.source_type}): ${rawLines.length} search line -> ${lines.length} line`);
                    }
                }

                // Lengkapi tiap line: on_hand (per item+lokasi), currency
                // (field header, bukan per-line — sama seperti msi_get_item_fulfillments.js),
                // dan custom segment Project Segmentation (per lineuniquekey).
                lines.forEach(line => {
                    const itemLocKey = (line.item && line.location !== null && line.location !== undefined && line.location !== '')
                        ? String(line.item) + '_' + String(line.location)
                        : '';
                    const ohData = itemLocKey ? onHandByItemLoc[itemLocKey] : null;
                    if (ohData !== null && ohData !== undefined) {
                        line.on_hand = ohData;
                    }

                    line.currency = header.currency;
                    line.currency_display = header.currency_display;

                    const segmentData = lineSegmentMap[line.line_id] || null;
                    line.cseg_msi_pro_segmen = segmentData ? segmentData.id : null;
                    line.cseg_msi_pro_segmen_display = segmentData ? segmentData.name : null;
                });

                header.lines = lines;
                header.files = filesByReceipt[String(header.receipt_id)] || [];
                header.user_notes = notesByReceipt[header.receipt_id] || [];
                let shipmentData = shipmentByPoId[header.createdfrom] || null;
                header.inboundshipment = shipmentData ? shipmentData.id : null;
                header.inboundshipment_display = shipmentData ? shipmentData.number : null;
                return header;
            });

            return {
                status:        'success',
                page,
                page_size:     pageSize,
                total_records: totalRecords,
                total_pages:   totalPages,
                data
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
