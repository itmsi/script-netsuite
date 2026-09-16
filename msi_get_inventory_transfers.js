/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Inventory Transfer (header + lines + inventory detail) dengan pagination & filters.
 * Format response mengikuti pola yang sama dengan msi_get_item_fulfillments.js,
 * msi_get_item_receipts.js, dan msi_get_inventory_adjustments.js supaya konsumen API
 * (frontend/integrasi) bisa memperlakukan semua tipe transaksi ini secara seragam.
 *
 * POST body:
{
  "page":       1,                              // Halaman (default: 1)
  "page_size":  20,                              // Jumlah data per halaman (default: 20)
  "sort_by":    "lastmodifieddate",             // Field untuk sorting (default: "lastmodifieddate")
  "sort_order": "DESC",                         // ASC / DESC (default: "DESC")
  "filters": {
    "id":                [1234, 5678],           // Filter by internal ID (opsional)
    "tranid":            "IT-2026-001",          // Filter by nomor transaksi, contains (opsional)
    "transactionnumber": "12345",                // Filter by Transaction Number, exact (opsional)
    "lastmodified":      "2026-03-31T23:59:00+07:00", // Filter tanggal diubah (opsional)
    "trandate_from":     "2026-01-01",           // Filter tanggal transaksi dari (opsional)
    "trandate_to":       "2026-06-30",           // Filter tanggal transaksi sampai (opsional)
    "subsidiary_id":     1,                      // Filter by subsidiary (opsional)
    "location_id":       19,                     // Filter by From Location (opsional)
    "transferlocation_id": 22,                   // Filter by To Location (opsional)
    "department_id":     103,                    // Filter by department (opsional)
    "class_id":          3                       // Filter by class (opsional)
  }
}
 *
 * CATATAN field ID sublist 'inventory' (dikonfirmasi dari XML inline-edit record
 * Inventory Transfer di UI NetSuite - lihat machine name="inventory" fields="..."):
 *   - Related Asset          -> custcol_far_trn_relatedasset
 *   - Project Segmentation   -> cseg_msi_pro_segmen (native field sublist, BUKAN
 *                                lewat SuiteQL seperti di Item Receipt/PO)
 *   - Qty. On Hand           -> quantityonhand
 *   - Qty. To Transfer       -> adjustqtyby (search column: 'quantity')
 *   - Sublist Inventory Transfer TIDAK punya department/class per baris
 *     (cuma header-level), makanya line di script ini tidak menyertakan itu.
 */

define(['N/search', 'N/log', 'N/record'], (search, log, record) => {

    function formatToISO(dateStr) {
        if (!dateStr) return null;

        // 1. FORMAT: DD/MM/YYYY HH:mm AM/PM
        var fullRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
        var m1 = dateStr.match(fullRegex);

        if (m1) {
            var day = parseInt(m1[1]);
            var month = parseInt(m1[2]);
            var year = parseInt(m1[3]);
            var hour = parseInt(m1[4]);
            var minute = parseInt(m1[5]);
            var ampm = m1[6].toUpperCase();

            if (ampm === 'PM' && hour !== 12) hour += 12;
            if (ampm === 'AM' && hour === 12) hour = 0;

            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;
        }

        // 2. FORMAT: DD/MM/YYYY (tanpa jam)
        var shortRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        var m2 = dateStr.match(shortRegex);

        if (m2) {
            var day = parseInt(m2[1]);
            var month = parseInt(m2[2]);
            var year = parseInt(m2[3]);

            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+07:00`;
        }

        // 3. FALLBACK
        var d = new Date(dateStr);
        if (isNaN(d)) return dateStr;

        return d.toISOString();
    }

    /**
     * Fungsi helper offset fetch next (bypass 4000 limit)
     */
    const fetchSearchResults = (searchObj, callback) => {
        let start = 0;
        let batchSize = 1000;
        let resultSet = searchObj.run();
        while (true) {
            let results = resultSet.getRange({ start: start, end: start + batchSize });
            if (!results || results.length === 0) break;

            for (let i = 0; i < results.length; i++) {
                callback(results[i]);
            }

            if (results.length < batchSize) break;
            start += batchSize;
        }
    };

    const post = (body) => {

        try {

            body = body || {};

            let page = body.page || 1;
            let pageSize = body.page_size || 20;
            let sortBy = body.sort_by || 'lastmodifieddate';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? false : true; // DESC = true

            let filtersBody = body.filters || {};

            // ── Bangun filter search ──────────────────────────────────────────
            let searchFilters = [
                ['mainline', 'is', 'T'],
                'AND',
                ['type', 'anyof', 'InvTrnfr']
            ];

            if (filtersBody.id && Array.isArray(filtersBody.id) && filtersBody.id.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.id]);
            }

            if (filtersBody.tranid) {
                searchFilters.push('AND', ['numbertext', 'contains', filtersBody.tranid]);
            }

            if (filtersBody.transactionnumber) {
                searchFilters.push('AND', ['transactionnumber', 'is', filtersBody.transactionnumber]);
            }

            if (filtersBody.lastmodified) {
                // Ambil komponen tanggal/jam APA ADANYA dari string ISO input
                // (bukan lewat new Date() + local getter) - getter lokal itu
                // bergantung ke timezone runtime yang gak konsisten, dan
                // sebelumnya jam dibuang total. Asumsi: offset di payload
                // sama dengan timezone akun NetSuite (WIB, +07:00).
                var lmMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(filtersBody.lastmodified));
                if (!lmMatch) {
                    throw new Error("filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + filtersBody.lastmodified + "'.");
                }

                var lmSqlDate = lmMatch[1] + '-' + lmMatch[2] + '-' + lmMatch[3] + ' ' +
                    lmMatch[4] + ':' + lmMatch[5] + ':' + (lmMatch[6] || '00');

                var lmFormula = "formulanumeric: CASE WHEN {lastmodifieddate} >= TO_DATE('" + lmSqlDate + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END";
                searchFilters.push('AND', [lmFormula, 'equalto', '1']);
            }

            if (filtersBody.trandate_from) {
                // Bug yang sama kayak lastmodified di atas (buang jam, timezone gak konsisten).
                var tfMatch = /^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2})?:?(\d{2})?:?(\d{2})?/.exec(String(filtersBody.trandate_from));
                if (!tfMatch) {
                    throw new Error("filters.trandate_from tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + filtersBody.trandate_from + "'.");
                }

                var tfSqlDate = tfMatch[1] + '-' + tfMatch[2] + '-' + tfMatch[3] + ' ' +
                    (tfMatch[4] || '00') + ':' + (tfMatch[5] || '00') + ':' + (tfMatch[6] || '00');

                var tfFormula = "formulanumeric: CASE WHEN {trandate} >= TO_DATE('" + tfSqlDate + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END";
                searchFilters.push('AND', [tfFormula, 'equalto', '1']);
            }

            if (filtersBody.trandate_to) {
                var dTo = new Date(filtersBody.trandate_to);
                var nsDateTo = dTo.getDate() + '/' + (dTo.getMonth() + 1) + '/' + dTo.getFullYear();
                searchFilters.push('AND', ['trandate', 'onorbefore', nsDateTo]);
            }

            if (filtersBody.subsidiary_id) {
                searchFilters.push('AND', ['subsidiary.internalid', 'anyof', filtersBody.subsidiary_id]);
            }

            if (filtersBody.location_id) {
                searchFilters.push('AND', ['location', 'anyof', filtersBody.location_id]);
            }

            if (filtersBody.transferlocation_id) {
                searchFilters.push('AND', ['transferlocation', 'anyof', filtersBody.transferlocation_id]);
            }

            if (filtersBody.department_id) {
                searchFilters.push('AND', ['department', 'anyof', filtersBody.department_id]);
            }

            if (filtersBody.class_id) {
                searchFilters.push('AND', ['class', 'anyof', filtersBody.class_id]);
            }

            // ── Search Columns ─────────────────────────────────────────────
            let sortColumn = sortBy;
            let searchColumns = [
                'tranid',
                'transactionnumber',
                'trandate',
                'postingperiod',
                'memo',
                'location',
                'transferlocation',
                'subsidiarynohierarchy',
                'department',
                'class',
                'lastmodifieddate',
                'datecreated',
                'createdby'
            ];

            if (sortColumn === 'lastmodifieddate') {
                searchColumns.unshift(search.createColumn({ name: 'lastmodifieddate', sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }));
                // Remove duplicate 'lastmodifieddate' string
                let idx = searchColumns.findIndex((c, i) => i > 0 && c === 'lastmodifieddate');
                if (idx > -1) searchColumns.splice(idx, 1);
            } else {
                let foundIndex = -1;
                for (let i = 0; i < searchColumns.length; i++) {
                    if (typeof searchColumns[i] === 'string' && searchColumns[i] === sortColumn) {
                        foundIndex = i;
                        break;
                    }
                }
                if (foundIndex > -1) {
                    searchColumns[foundIndex] = search.createColumn({ name: sortColumn, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC });
                } else {
                    searchColumns.push(search.createColumn({ name: sortColumn, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }));
                }
            }

            // ── Buat Search Header ─────────────────────────────────────────────
            let headerSearch = search.create({
                type: search.Type.INVENTORY_TRANSFER,
                filters: searchFilters,
                columns: searchColumns
            });

            // ── Eksekusi Search Berhalaman (Bypass Limit Minimal Page Size NetSuite < 5) ──
            let totalRecords = 0;
            let totalPages = 0;
            let searchResults = [];

            if (pageSize >= 5) {
                let pagedData = headerSearch.runPaged({ pageSize: pageSize });
                totalRecords = pagedData.count;
                totalPages = pagedData.pageRanges.length;

                if (totalRecords > 0 && page <= totalPages) {
                    let searchPage = pagedData.fetch({ index: page - 1 });
                    searchResults = searchPage.data;
                }
            } else {
                totalRecords = headerSearch.runPaged().count;
                totalPages = Math.ceil(totalRecords / pageSize);

                if (totalRecords > 0 && page <= totalPages) {
                    let startIndex = (page - 1) * pageSize;
                    let endIndex = startIndex + pageSize;
                    searchResults = headerSearch.run().getRange({ start: startIndex, end: endIndex }) || [];
                }
            }

            if (totalRecords === 0 || page > totalPages) {
                return {
                    status: 'success',
                    page,
                    page_size: pageSize,
                    total_records: totalRecords,
                    total_pages: totalPages,
                    data: []
                };
            }

            let pagedHeaders = [];
            let foundItIds = [];

            searchResults.forEach(res => {
                foundItIds.push(res.id);
                pagedHeaders.push({
                    id: res.id,
                    tranid: res.getValue('tranid'),
                    transactionnumber: res.getValue('transactionnumber'),
                    trandate: res.getValue('trandate'),
                    postingperiod: res.getValue('postingperiod'),
                    postingperiod_display: res.getText('postingperiod'),
                    memo: res.getValue('memo'),
                    location: res.getValue('location'),
                    location_display: res.getText('location'),
                    transferlocation: res.getValue('transferlocation'),
                    transferlocation_display: res.getText('transferlocation'),
                    subsidiary: res.getValue('subsidiarynohierarchy'),
                    subsidiary_display: res.getText('subsidiarynohierarchy'),
                    department: res.getValue('department'),
                    department_display: res.getText('department'),
                    class: res.getValue('class'),
                    class_display: res.getText('class'),
                    last_modified: formatToISO(res.getValue('lastmodifieddate')),
                    datecreated: formatToISO(res.getValue('datecreated')),
                    created_by_id: res.getValue('createdby') ? Number(res.getValue('createdby')) : null,
                    created_by_name: res.getText('createdby') || null,
                });
            });

            // ── Search Line Items (field standar via N/search) ─────────────────
            let linesByIt = {};
            if (foundItIds.length > 0) {
                let lineSearch = search.create({
                    type: search.Type.INVENTORY_TRANSFER,
                    filters: [
                        ['internalid', 'anyof', foundItIds],
                        'AND',
                        ["type","anyof","InvTrnfr"], 
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F'],
                        'AND', 
                        ['formulanumeric: {quantity}', 'greaterthanorequalto', '0']
                    ],
                    columns: [
                        'internalid',
                        search.createColumn({ name: 'line', sort: search.Sort.ASC }),
                        'lineuniquekey',
                        'item',
                        'memo',
                        'quantity', // = 'adjustqtyby' / Qty. To Transfer
                        'custcol_4601_witaxapplies', // Apply WH Tax?
                        search.createColumn({ name: 'displayname', join: 'item' }),
                        // Inventory Detail (serial/lot) via join langsung dari line -
                        // pola yang sama seperti msi_get_customer_returns.js /
                        // msi_get_item_receipts.js. Search type 'inventorydetail'
                        // berdiri sendiri (dengan kolom 'line') TIDAK valid untuk
                        // Inventory Transfer ("nlobjSearchColumn ... invalid column:
                        // line"), jadi baris dgn >1 serial/lot bakal fan-out jadi
                        // banyak search result row (di-dedupe di bawah pakai lineKey).
                        search.createColumn({ name: "internalid", join: "inventoryDetail"}),
                        search.createColumn({ name: 'quantity', join: 'inventorydetail' }),
                    ]
                });

                fetchSearchResults(lineSearch, res => {
                    let itId = res.getValue('internalid');
                    let lineKey = res.getValue('lineuniquekey');

                    if (!linesByIt[itId]) linesByIt[itId] = { lines: [], byKey: {} };
                    let tranObj = linesByIt[itId];

                    let invDetail = null;
                    let invNum = res.getValue({ name: 'internalid', join: 'inventorydetail' });
                    let invQty = res.getValue({ name: 'quantity', join: 'inventorydetail' });

                    if (invNum || invQty) {
                        invDetail = {
                            internal_id: invNum,
                            quantity: invQty
                        };
                    }

                    if (!tranObj.byKey[lineKey]) {
                        let newLine = {
                            line: Number(res.getValue('line')),
                            line_id: lineKey,
                            transaction: itId,
                            item: res.getValue('item'),
                            item_display: res.getText('item'),
                            item_displayname: res.getValue({ name: 'displayname', join: 'item' }),
                            memo: res.getValue('memo'),
                            qty_to_transfer: res.getValue('quantity') ? Number(res.getValue('quantity')) : 0,
                            apply_wh_tax: res.getValue('custcol_4601_witaxapplies') === true || res.getValue('custcol_4601_witaxapplies') === 'T',
                            // field berikut diisi belakangan via N/record (tidak
                            // reliabel/tidak tersedia lewat N/search untuk sublist
                            // 'inventory' di Inventory Transfer)
                            units: null,
                            units_display: null,
                            qty_on_hand: null,
                            inventory_detail: invDetail ? [invDetail] : [],
                            related_asset: null,
                            related_asset_display: null,
                            cseg_msi_pro_segmen: null,
                            cseg_msi_pro_segmen_display: null
                        };
                        tranObj.lines.push(newLine);
                        tranObj.byKey[lineKey] = newLine;
                    } else if (invDetail) {
                        tranObj.byKey[lineKey].inventory_detail.push(invDetail);
                    }
                    return true;
                });
            }

            // ── Ambil Units / Qty On Hand / Related Asset / Project Segmentation per
            //    baris, dan header 'transferlocation' via N/record ────────────────
            // Sama seperti msi_get_inventory_adjustments.js: sublist Inventory Transfer
            // adalah 'inventory', dan field-field ini tidak reliabel lewat N/search
            // untuk sublist ini. Field header 'transferlocation' juga ikut diambil di
            // sini karena kolom search 'transferlocation' pada mainline row Inventory
            // Transfer selalu balik kosong (beda dari Transfer Order / Item
            // Fulfillment), padahal via record.load nilainya ada.
            let lineDetailsByKey = {};
            let transferLocationById = {};
            if (foundItIds.length > 0) {
                foundItIds.forEach(itId => {
                    try {
                        let itRecord = record.load({
                            type: record.Type.INVENTORY_TRANSFER,
                            id: itId
                        });

                        transferLocationById[itId] = {
                            id: itRecord.getValue({ fieldId: 'transferlocation' }) || null,
                            display: itRecord.getText({ fieldId: 'transferlocation' }) || null
                        };

                        let lineCount = itRecord.getLineCount({ sublistId: 'inventory' });
                        for (let i = 0; i < lineCount; i++) {
                            let lineNum = itRecord.getSublistValue({
                                sublistId: 'inventory',
                                fieldId: 'line',
                                line: i
                            });
                            let key = itId + '_' + lineNum;

                            lineDetailsByKey[key] = {
                                units: itRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'units', line: i }) || null,
                                units_display: itRecord.getSublistText({ sublistId: 'inventory', fieldId: 'units', line: i }) || null,
                                qty_on_hand: (function (v) { return v !== null && v !== undefined && v !== '' ? Number(v) : null; })(itRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'quantityonhand', line: i })),
                                related_asset: itRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'custcol_far_trn_relatedasset', line: i }) || null,
                                related_asset_display: itRecord.getSublistText({ sublistId: 'inventory', fieldId: 'custcol_far_trn_relatedasset', line: i }) || null,
                                cseg_msi_pro_segmen: itRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'cseg_msi_pro_segmen', line: i }) || null,
                                cseg_msi_pro_segmen_display: itRecord.getSublistText({ sublistId: 'inventory', fieldId: 'cseg_msi_pro_segmen', line: i }) || null
                            };
                        }
                    } catch (e) {
                        log.error('Record Load Error for Inventory Transfer ' + itId, e.message);
                    }
                });
            }

            // Merge transferlocation (dari record.load) ke pagedHeaders
            pagedHeaders.forEach(h => {
                let loc = transferLocationById[h.id];
                if (loc) {
                    h.transferlocation = loc.id;
                    h.transferlocation_display = loc.display;
                }
            });

            // ── Search User Notes ─────────────────────────────────────────────
            let notesByIt = {};
            if (foundItIds.length > 0) {
                let noteSearch = search.create({
                    type: 'note',
                    filters: [
                        search.createFilter({
                            name: 'internalid',
                            join: 'transaction',
                            operator: search.Operator.ANYOF,
                            values: foundItIds
                        })
                    ],
                    columns: [
                        'internalid',
                        search.createColumn({ name: 'internalid', join: 'transaction' }),
                        'title', 'note', 'notedate', 'author', 'direction', 'notetype'
                    ]
                });

                let processedNoteIds = {};
                fetchSearchResults(noteSearch, res => {
                    let noteRecordId = res.id;
                    if (processedNoteIds[noteRecordId]) return true;
                    processedNoteIds[noteRecordId] = true;

                    let itId = res.getValue({ name: 'internalid', join: 'transaction' });
                    if (!notesByIt[itId]) notesByIt[itId] = [];

                    notesByIt[itId].push({
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

            // ── Search Custom Attach Files ────────────────────────────────────
            let filesByIt = {};
            if (foundItIds.length > 0) {
                try {
                    let idOrFilters = [];
                    foundItIds.forEach((id, i) => {
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

                    let processedFileIds = {};
                    fetchSearchResults(fileSearch, res => {
                        let fileRecordId = res.id;
                        if (processedFileIds[fileRecordId]) return true;
                        processedFileIds[fileRecordId] = true;

                        let itId = res.getValue('custrecord_msi_transaction_id');
                        if (!itId) return true;
                        if (!filesByIt[itId]) filesByIt[itId] = [];
                        filesByIt[itId].push({
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

            // ── Gabungkan header + lines + inventory detail + notes + files ───
            let data = pagedHeaders.map(header => {
                let lines = (linesByIt[header.id] && linesByIt[header.id].lines) || [];

                lines.forEach(line => {
                    let lineKey = header.id + '_' + line.line;
                    let det = lineDetailsByKey[lineKey] || {};
                    line.units = det.units || null;
                    line.units_display = det.units_display || null;
                    line.qty_on_hand = det.qty_on_hand !== null && det.qty_on_hand !== undefined ? det.qty_on_hand : null;
                    line.related_asset = det.related_asset || null;
                    line.related_asset_display = det.related_asset_display || null;
                    line.cseg_msi_pro_segmen = det.cseg_msi_pro_segmen || null;
                    line.cseg_msi_pro_segmen_display = det.cseg_msi_pro_segmen_display || null;
                });

                header.lines = lines;
                header.user_notes = notesByIt[header.id] || [];
                header.files = filesByIt[String(header.id)] || [];
                return header;
            });

            return {
                status: 'success',
                page,
                page_size: pageSize,
                total_records: totalRecords,
                total_pages: totalPages,
                data
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
