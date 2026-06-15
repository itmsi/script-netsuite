/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Inventory Adjustment (header + lines + inventory detail) dengan pagination & filters
 *
 * POST body:
{
  "page":       1,                              // Halaman (default: 1)
  "page_size":  20,                             // Jumlah data per halaman (default: 20)
  "sort_by":    "lastmodifieddate",             // Field untuk sorting (default: "lastmodifieddate")
  "sort_order": "DESC",                         // ASC / DESC (default: "DESC")
  "filters": {
    "id":            [1234, 5678],              // Filter by internal ID (opsional)
    "tranid":        "IA-2026-001",             // Filter by nomor transaksi (opsional)
    "lastmodified":  "2026-03-31T23:59:00+07:00", // Filter tanggal diubah (opsional)
    "trandate_from": "2026-01-01",             // Filter tanggal transaksi dari (opsional)
    "trandate_to":   "2026-06-30",             // Filter tanggal transaksi sampai (opsional)
    "subsidiary_id": 1,                        // Filter by subsidiary (opsional)
    "location_id":   214,                      // Filter by location (opsional)
    "department_id": 103,                      // Filter by department (opsional)
    "class_id":      3,                        // Filter by class (opsional)
    "account_id":    100                       // Filter by account (opsional)
  }
}
 */

define(['N/search', 'N/query', 'N/log', 'N/record'], (search, query, log, record) => {

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
                ['type', 'anyof', 'InvAdjst']
            ];

            if (filtersBody.id && Array.isArray(filtersBody.id) && filtersBody.id.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.id]);
            }

            if (filtersBody.tranid) {
                searchFilters.push('AND', ['numbertext', 'contains', filtersBody.tranid]);
            }

            if (filtersBody.lastmodified) {
                var d = new Date(filtersBody.lastmodified);
                var nsDate = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            if (filtersBody.trandate_from) {
                var dFrom = new Date(filtersBody.trandate_from);
                var nsDateFrom = dFrom.getDate() + '/' + (dFrom.getMonth() + 1) + '/' + dFrom.getFullYear();
                searchFilters.push('AND', ['trandate', 'onorafter', nsDateFrom]);
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

            if (filtersBody.department_id) {
                searchFilters.push('AND', ['department', 'anyof', filtersBody.department_id]);
            }

            if (filtersBody.class_id) {
                searchFilters.push('AND', ['class', 'anyof', filtersBody.class_id]);
            }

            if (filtersBody.account_id) {
                searchFilters.push('AND', ['account', 'anyof', filtersBody.account_id]);
            }

            // ── Search Columns ─────────────────────────────────────────────
            let sortColumn = sortBy;
            let searchColumns = [
                'tranid',
                'entity',
                'trandate',
                'account',
                'postingperiod',
                'memo',
                'custbody_me_purchase_order_number',
                'custbody_msi_cycle_count_cumber',
                'custbody_me_opening_balance',
                'custbody_me_wf_created_by',
                'custbody_me_approval_status',
                'custbody_me_wf_next_approver_blank',
                'custbody_me_delegate_approver',
                'custbody_me_wf_in_delegation',
                'subsidiarynohierarchy',
                'department',
                'class',
                'lastmodifieddate',
                'datecreated',
                search.createColumn({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' })
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
                type: search.Type.INVENTORY_ADJUSTMENT,
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
            let foundIaIds = [];

            searchResults.forEach(res => {
                foundIaIds.push(res.id);
                pagedHeaders.push({
                    id: res.id,
                    tranid: res.getValue('tranid'),
                    trandate: formatToISO(res.getValue('trandate')),
                    customer: res.getValue('entity'),
                    customer_display: res.getText('entity'),
                    account: res.getValue('account'),
                    account_display: res.getText('account'),
                    postingperiod: res.getValue('postingperiod'),
                    postingperiod_display: res.getText('postingperiod'),
                    memo: res.getValue('memo'),
                    custbody_me_purchase_order_number: res.getValue('custbody_me_purchase_order_number'),
                    custbody_msi_cycle_count_cumber: res.getValue('custbody_msi_cycle_count_cumber'),
                    custbody_me_opening_balance: res.getValue('custbody_me_opening_balance'),
                    custbody_me_wf_created_by: res.getValue('custbody_me_wf_created_by'),
                    custbody_me_wf_created_by_display: res.getText('custbody_me_wf_created_by'),
                    custbody_me_approval_status: res.getValue('custbody_me_approval_status'),
                    custbody_me_approval_status_display: res.getText('custbody_me_approval_status'),
                    custbody_me_wf_next_approver_blank: res.getValue('custbody_me_wf_next_approver_blank'),
                    custbody_me_delegate_approver: res.getValue('custbody_me_delegate_approver'),
                    custbody_me_delegate_approver_display: res.getText('custbody_me_delegate_approver'),
                    custbody_me_wf_in_delegation: res.getValue('custbody_me_wf_in_delegation'),
                    subsidiary: res.getValue('subsidiarynohierarchy'),
                    subsidiary_display: res.getText('subsidiarynohierarchy'),
                    department: res.getValue('department'),
                    department_display: res.getText('department'),
                    class: res.getValue('class'),
                    class_display: res.getText('class'),
                    adjlocation: null,   // diisi via SuiteQL di bawah
                    adjlocation_display: null,
                    nextapprover: res.getText({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }),
                    last_modified: formatToISO(res.getValue('lastmodifieddate')),
                    datecreated: formatToISO(res.getValue('datecreated'))
                });
            });

            // ── Ambil adjlocation via SuiteQL (tidak tersedia di N/search) ──────
            let adjLocationMap = {};
            if (foundIaIds.length > 0) {
                try {
                    let sql = `
                        SELECT
                            t.id                         AS ia_id,
                            t.adjlocation                AS adjlocation_id,
                            BUILTIN.DF(t.adjlocation)    AS adjlocation_display
                        FROM
                            Transaction t
                        WHERE
                            t.id IN (${foundIaIds.join(',')})
                    `;
                    let sqlResults = query.runSuiteQL({ query: sql }).asMappedResults();
                    sqlResults.forEach(r => {
                        adjLocationMap[String(r.ia_id)] = {
                            id: r.adjlocation_id,
                            display: r.adjlocation_display
                        };
                    });
                } catch (e) {
                    log.error('adjlocation SuiteQL Error', e.message);
                }

                // Merge adjlocation ke pagedHeaders
                pagedHeaders.forEach(h => {
                    let loc = adjLocationMap[String(h.id)];
                    if (loc) {
                        h.adjlocation = loc.id;
                        h.adjlocation_display = loc.display;
                    }
                });
            }

            // ── Search Line Items ─────────────────────────────────────────────
            let linesByIa = {};
            if (foundIaIds.length > 0) {
                let lineSearch = search.create({
                    type: search.Type.INVENTORY_ADJUSTMENT,
                    filters: [
                        ['internalid', 'anyof', foundIaIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F']
                    ],
                    columns: [
                        'internalid',
                        'line',
                        'lineuniquekey',
                        'item',
                        'itemtype',
                        'memo',
                        'location',
                        'department',
                        'class',
                        'quantity',           // adjustqtyby / proposed qty
                        'custcol_me_landed_cost_ia',
                        'custcol_me_purchase_number_line',
                        'custcol_me_proposed_lot_num_txt',
                        'custcol_me_proposed_lot_qty',
                        'custcol_me_proposed_qty',
                        'custcol_me_proposed_unit_cost'
                    ]
                });

                fetchSearchResults(lineSearch, res => {
                    let iaId = res.getValue('internalid');
                    if (!linesByIa[iaId]) linesByIa[iaId] = [];

                    linesByIa[iaId].push({
                        transaction: iaId,
                        linesequencenumber: Number(res.getValue('line')),
                        line_id: res.getValue('lineuniquekey'),
                        item: res.getValue('item'),
                        item_display: res.getText('item'),
                        itemtype: res.getValue('itemtype'),
                        description: null,           // diisi via SuiteQL
                        memo: res.getValue('memo'),
                        location: res.getValue('location'),
                        location_display: res.getText('location'),
                        department: res.getValue('department'),
                        department_display: res.getText('department'),
                        class: res.getValue('class'),
                        class_display: res.getText('class'),
                        adjustqtyby: res.getValue('quantity'),
                        custcol_me_landed_cost_ia: res.getValue('custcol_me_landed_cost_ia'),
                        custcol_me_purchase_number_line: res.getValue('custcol_me_purchase_number_line'),
                        custcol_me_proposed_lot_num_txt: res.getValue('custcol_me_proposed_lot_num_txt'),
                        custcol_me_proposed_qty: res.getValue('custcol_me_proposed_qty'),
                        custcol_me_proposed_unit_cost: res.getValue('custcol_me_proposed_unit_cost'),
                        // field berikut diisi via SuiteQL (tidak tersedia di N/search untuk line IA)
                        units: null,
                        units_display: null,
                        quantityonhand: null,
                    });
                    return true;
                });
            }

            // ── Ambil field line via N/record (karena SuiteQL / N/search tidak bisa akses
            //    quantityonhand, currentvalue, newquantity untuk TransactionLine) ──────
            //    CATATAN: Sublist Inventory Adjustment adalah 'inventory', BUKAN 'item'!
            let lineDetailsByKey = {};
            if (foundIaIds.length > 0) {
                foundIaIds.forEach(iaId => {
                    try {
                        let iaRecord = record.load({
                            type: record.Type.INVENTORY_ADJUSTMENT,
                            id: iaId
                        });

                        let lineCount = iaRecord.getLineCount({ sublistId: 'inventory' });
                        for (let i = 0; i < lineCount; i++) {
                            let lineNum = iaRecord.getSublistValue({
                                sublistId: 'inventory',
                                fieldId: 'line',
                                line: i
                            });
                            let key = iaId + '_' + lineNum;

                            lineDetailsByKey[key] = {
                                units: iaRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'units', line: i }) || null,
                                units_display: iaRecord.getSublistText({ sublistId: 'inventory', fieldId: 'units', line: i }) || null,
                                description: iaRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'description', line: i }) || null,
                                quantityonhand: (function(v) { return v !== null && v !== undefined ? Number(v) : null; })(iaRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'quantityonhand', line: i })),
                                currentvalue: iaRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'currentvalue', line: i }) || null,
                                newquantity: (function(v) { return v !== null && v !== undefined ? Number(v) : null; })(iaRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'newquantity', line: i })),
                                inventorydetail: (function(v) { return v !== null && v !== undefined ? Number(v) : null; })(iaRecord.getSublistValue({ sublistId: 'inventory', fieldId: 'inventorydetail', line: i }))
                            };
                        }
                    } catch (e) {
                        log.error('Record Load Error for IA ' + iaId, e.message);
                    }
                });
            }



            // ── Search User Notes ─────────────────────────────────────────────
            let notesByIa = {};
            if (foundIaIds.length > 0) {
                let noteSearch = search.create({
                    type: 'note',
                    filters: [
                        search.createFilter({
                            name: 'internalid',
                            join: 'transaction',
                            operator: search.Operator.ANYOF,
                            values: foundIaIds
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

                    let iaId = res.getValue({ name: 'internalid', join: 'transaction' });
                    if (!notesByIa[iaId]) notesByIa[iaId] = [];

                    notesByIa[iaId].push({
                        title: res.getValue('title'),
                        note: res.getValue('note'),
                        date: res.getValue('notedate'),
                        author: res.getText('author'),
                        direction: res.getValue('direction'),
                        type: res.getValue('notetype')
                    });
                    return true;
                });
            }

            // ── Search Custom Attach Files ────────────────────────────────────
            let filesByIa = {};
            if (foundIaIds.length > 0) {
                try {
                    let idOrFilters = [];
                    foundIaIds.forEach((id, i) => {
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

                        let iaId = res.getValue('custrecord_msi_transaction_id');
                        if (!iaId) return true;
                        if (!filesByIa[iaId]) filesByIa[iaId] = [];
                        filesByIa[iaId].push({
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
                let lines = linesByIa[header.id] || [];

                // Map field SuiteQL & inventory detail ke tiap line
                lines.forEach(line => {
                    let lineKey = header.id + '_' + line.linesequencenumber;
                    let det = lineDetailsByKey[lineKey] || {};
                    line.units = det.units || null;
                    line.units_display = det.units_display || null;
                    line.description = det.description || null;
                    line.quantityonhand = det.quantityonhand !== null && det.quantityonhand !== undefined ? det.quantityonhand : null;
                    line.currentvalue = det.currentvalue || "0.00";
                    line.newquantity = det.newquantity !== null && det.newquantity !== undefined ? det.newquantity : null;
                    line.inventorydetail = det.inventorydetail || null;
                });

                header.lines = lines;
                header.user_notes = notesByIa[header.id] || [];
                header.files = filesByIa[String(header.id)] || [];
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
