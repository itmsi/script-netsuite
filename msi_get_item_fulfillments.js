/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Item Fulfillment (header + lines + inventory detail) dengan pagination & filters
 *
 * POST body:
{
  "page":       1,               // Halaman (default: 1)
  "page_size":  20,              // Jumlah data per halaman (default: 20)
  "sort_by":    "internalid",    // Field untuk sorting (default: "internalid")
  "sort_order": "DESC",          // ASC / DESC (default: "DESC")
  "filters": {
    "id":        [1234, 5678],   // Filter by ID (opsional)
    "number":     "IF-2026-001",  // Filter by nomor IF (opsional)
    "status":        "C",            // Status: B=Picked, C=Packed, D=Shipped (opsional)
    "lastmodified":  "2026-03-31T23:59:00+07:00", // Filter tanggal diubah (opsional)
    "vendor_id":     10,             // Filter by vendor/entity ID (opsional)
    "createdfrom":   5157,           // Filter by created from PO ID (opsional)
    "source_type":   "sales_order",  // "sales_order" | "transfer_order" | "vendor_return" (opsional)
    "trandate_from": "2026-01-01",   // Filter tanggal transaksi dari (opsional)
    "trandate_to":   "2026-06-30",   // Filter tanggal transaksi sampai (opsional)
    "subsidiary_id": 1               // Filter by subsidiary (opsional)
  }
}
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

            if (ampm === "PM" && hour !== 12) hour += 12;
            if (ampm === "AM" && hour === 12) hour = 0;

            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`;
        }

        // 2. FORMAT: DD/MM/YYYY (tanpa jam)
        var shortRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        var m2 = dateStr.match(shortRegex);

        if (m2) {
            var day = parseInt(m2[1]);
            var month = parseInt(m2[2]);
            var year = parseInt(m2[3]);

            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`;
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
        let pageSize = 1000;
        let resultSet = searchObj.run();
        while (true) {
            let results = resultSet.getRange({ start: start, end: start + pageSize });
            if (!results || results.length === 0) break;

            for (let i = 0; i < results.length; i++) {
                callback(results[i]);
            }

            if (results.length < pageSize) break;
            start += pageSize;
        }
    };

    /**
     * Fungsi helper untuk memetakan ship status code ke label
     */
    const statusLabel = (code) => {
        const map = {
            'B': 'Picked',
            'C': 'Packed',
            'D': 'Shipped'
        };
        return map[code] || code;
    };

    const post = (body) => {

        try {

            body = body || {};

            let page = body.page || 1;
            let pageSize = body.page_size || 20;
            let sortBy = body.sort_by || 'lastmodifieddate';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? false : true;

            let filtersBody = body.filters || {};

            // ── Bangun filter search ──────────────────────────────────────────
            let searchFilters = [
                ['mainline', 'is', 'T'],
                'AND',
                ['type', 'anyof', 'ItemShip']
            ];

            if (filtersBody.id && Array.isArray(filtersBody.id) && filtersBody.id.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.id]);
            }

            if (filtersBody.number) {
                searchFilters.push('AND', ['numbertext', 'is', filtersBody.number]);
            }

            if (filtersBody.status) {
                const status = filtersBody.status.startsWith('ItemShip:') ? filtersBody.status : `ItemShip:${filtersBody.status}`;
                searchFilters.push('AND', ['status', 'anyof', status]);
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

            if (filtersBody.vendor_id) {
                searchFilters.push('AND', ['entity.internalid', 'anyof', filtersBody.vendor_id]);
            }

            if (filtersBody.createdfrom) {
                searchFilters.push('AND', ['createdfrom.internalid', 'anyof', filtersBody.createdfrom]);
            }

            // source_type: pola sama seperti msi_get_item_receipts.js — Item Fulfillment
            // umumnya dibuat dari Sales Order, tapi bisa juga dari Transfer Order (kirim
            // antar lokasi) atau Vendor Return Authorization (kirim balik barang ke vendor).
            const sourceTypeMap = {
                'sales_order':    'SalesOrd',
                'transfer_order': 'TrnfrOrd',
                'vendor_return':  'VendAuth'
            };
            const sourceTypeMapReverse = {
                'SalesOrd': 'sales_order',
                'TrnfrOrd': 'transfer_order',
                'VendAuth': 'vendor_return'
            };

            if (filtersBody.source_type) {
                let sourceTypeId = sourceTypeMap[filtersBody.source_type];
                if (!sourceTypeId) {
                    throw new Error("filters.source_type tidak valid. Gunakan: 'sales_order', 'transfer_order', atau 'vendor_return'.");
                }
                searchFilters.push('AND', ['createdfrom.type', 'anyof', sourceTypeId]);
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

            // ── Search Columns ─────────────────────────────────────────────
            let sortColumn = sortBy;
            let searchColumns = [
                'tranid', 'trandate', 'status', 'memo', 'entity',
                'createdfrom', 'postingperiod', 'lastmodifieddate',
                'custbody_me_wf_created_by',
                'custbody_me_approval_status',
                'custbody_me_delegate_approver',
                'custbody_me_wf_in_delegation',
                'custbody_me_wf_next_approver_blank',
                search.createColumn({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }),
                'custbody_cseg_cn_cfi',
                'custbody_me_logistic_vendor',
                'custbody_me_gross_weight',
                'custbody_me_related_invoice',
                'custbody_me_rate_id',
                'custbody_me_packages',
                'custbody_me_total_packages',
                'subsidiary', 'subsidiarynohierarchy',
                'location', 'transferlocation', 'department', 'class',
                'datecreated',
                search.createColumn({ name: 'type', join: 'createdfrom' })
            ];

            if (sortColumn === 'lastmodifieddate') {
                searchColumns.unshift(search.createColumn({ name: 'lastmodifieddate', sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }));
            } else {
                searchColumns.unshift('lastmodifieddate');
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
                type: search.Type.ITEM_FULFILLMENT,
                filters: searchFilters,
                columns: searchColumns
            });

            // ── Eksekusi Search Berhalaman ──────────────────────────────────────
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
            let foundIfIds = [];

            searchResults.forEach(res => {
                foundIfIds.push(res.id);
                pagedHeaders.push({
                    id: res.id,
                    number: res.getValue('tranid'),
                    date: res.getValue('trandate'),
                    status: res.getValue('status'),
                    status_label: res.getText('status'),
                    status: (res.getValue('status') || '').replace('ItemShip:', ''),
                    status_label: statusLabel((res.getValue('status') || '').replace('ItemShip:', '')),
                    memo: res.getValue('memo'),
                    entity_id: res.getValue('entity'),
                    entity_name: res.getText('entity'),
                    createdfrom_id: res.getValue('createdfrom'),
                    createdfrom_number: res.getText('createdfrom'),
                    source_type: sourceTypeMapReverse[res.getValue({ name: 'type', join: 'createdfrom' })] || null,
                    source_type_display: res.getText({ name: 'type', join: 'createdfrom' }),
                    postingperiod: res.getText('postingperiod'),
                    last_modified: formatToISO(res.getValue('lastmodifieddate')),
                    created_by: res.getText('custbody_me_wf_created_by'),
                    custbody_me_wf_created_by: res.getValue('custbody_me_wf_created_by'),
                    custbody_me_approval_status: res.getValue('custbody_me_approval_status'),
                    custbody_me_approval_status_display: res.getText('custbody_me_approval_status'),
                    custbody_me_delegate_approver: res.getValue('custbody_me_delegate_approver'),
                    custbody_me_wf_in_delegation: res.getValue('custbody_me_wf_in_delegation'),
                    custbody_me_wf_next_approver_blank: res.getValue('custbody_me_wf_next_approver_blank'),
                    nextapprover: res.getText({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }),
                    custbody_cseg_cn_cfi: res.getValue('custbody_cseg_cn_cfi'),
                    custbody_cseg_cn_cfi_display: res.getText('custbody_cseg_cn_cfi'),
                    custbody_me_logistic_vendor: res.getValue('custbody_me_logistic_vendor'),
                    custbody_me_logistic_vendor_display: res.getText('custbody_me_logistic_vendor'),
                    custbody_me_gross_weight: res.getValue('custbody_me_gross_weight'),
                    custbody_me_related_invoice: res.getValue('custbody_me_related_invoice'),
                    custbody_me_rate_id: res.getValue('custbody_me_rate_id'),
                    custbody_me_rate_id_display: res.getText('custbody_me_rate_id'),
                    custbody_me_packages: res.getValue('custbody_me_packages'),
                    custbody_me_total_packages: res.getValue('custbody_me_total_packages'),
                    subsidiary: res.getValue('subsidiarynohierarchy'),
                    subsidiary_display: res.getText('subsidiarynohierarchy'), 
                    location: res.getValue('location'),
                    location_display: res.getText('location'),
                    transferlocation: res.getValue('transferlocation'),
                    transferlocation_display: res.getText('transferlocation'),
                    department: res.getValue('department'),
                    department_display: res.getText('department'),
                    class: res.getValue('class'),
                    class_display: res.getText('class'),
                    datecreated: formatToISO(res.getValue('datecreated'))
                });
            });

            // ── Search Line Items ─────────────────────────────────────────────
            let linesByIf = {};
            if (foundIfIds.length > 0) {
                let lineSearch = search.create({
                    type: search.Type.ITEM_FULFILLMENT,
                    filters: [
                        ['internalid', 'anyof', foundIfIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['shipping', 'is', 'F']
                    ],
                    columns: [
                        'internalid', 'line', 'lineuniquekey',
                        'item', 'itemtype', 'memo',
                        'quantity',
                        'location', 'department', 'class'
                    ]
                });

                fetchSearchResults(lineSearch, res => {
                    let ifId = res.getValue('internalid');
                    if (!linesByIf[ifId]) linesByIf[ifId] = [];

                    linesByIf[ifId].push({
                        transaction: ifId,
                        linesequencenumber: Number(res.getValue('line')),
                        line_id: res.getValue('lineuniquekey'),
                        item: res.getValue('item'),
                        item_display: res.getText('item'),
                        itemtype: res.getValue('itemtype'),
                        memo: res.getValue('memo'),
                        quantity: res.getValue('quantity'),
                        units: res.getValue('units'),
                        units_display: res.getText('units'),
                        location: res.getValue('location'),
                        location_display: res.getText('location'),
                        department: res.getValue('department'),
                        department_display: res.getText('department'),
                        class: res.getValue('class'),
                        class_display: res.getText('class')
                    });
                    return true;
                });
            }

            // ── Ambil Units & field line via N/record ────────────────────────
            let unitsByLineKey = {};
            if (foundIfIds.length > 0) {
                foundIfIds.forEach(ifId => {
                    try {
                        let ifRecord = record.load({
                            type: record.Type.ITEM_FULFILLMENT,
                            id: ifId
                        });

                        let lineCount = ifRecord.getLineCount({ sublistId: 'item' });
                        for (let i = 0; i < lineCount; i++) {
                            let lineNum = ifRecord.getSublistValue({
                                sublistId: 'item',
                                fieldId: 'line',
                                line: i
                            });
                            let lineUniqueKey = ifRecord.getSublistValue({
                                sublistId: 'item',
                                fieldId: 'lineuniquekey',
                                line: i
                            });
                            if (lineUniqueKey) {
                                unitsByLineKey[lineUniqueKey] = ifRecord.getSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'units',
                                    line: i
                                }) || null;
                            }
                        }
                    } catch (e) {
                        log.error('Record Load Error for IF ' + ifId, e.message);
                    }
                });
            }

            // ── Search Inventory Detail per Line ───────────────────────────────
            let inventoryByLineKey = {};
            if (foundIfIds.length > 0) {
                try {
                    let invDetailSearch = search.create({
                        type: 'inventorydetail',
                        filters: [
                            search.createFilter({
                                name: 'internalid',
                                join: 'transaction',
                                operator: search.Operator.ANYOF,
                                values: foundIfIds
                            })
                        ],
                        columns: [
                            search.createColumn({ name: 'internalid', join: 'transaction' }),
                            'line',
                            'quantity',
                            'inventorynumber',
                            'expirationdate',
                            'manualno',
                            search.createColumn({ name: 'quantity', join: 'inventorynumber' }),
                            search.createColumn({ name: 'expirationdate', join: 'inventorynumber' }),
                            search.createColumn({ name: 'lotnumber', join: 'inventorynumber' }),
                            'custrecord_me_inventory_detail'
                        ]
                    });

                    fetchSearchResults(invDetailSearch, res => {
                        let ifId = res.getValue({ name: 'internalid', join: 'transaction' });
                        let lineNum = res.getValue('line');
                        let key = `${ifId}_${lineNum}`;

                        if (!inventoryByLineKey[key]) inventoryByLineKey[key] = [];

                        inventoryByLineKey[key].push({
                            inventorynumber_id: res.getValue('inventorynumber'),
                            inventorynumber_text: res.getText('inventorynumber'),
                            lotnumber: res.getText({ name: 'lotnumber', join: 'inventorynumber' }),
                            quantity: res.getValue('quantity'),
                            quantity_onhand: res.getValue({ name: 'quantity', join: 'inventorynumber' }),
                            expirationdate: res.getValue('expirationdate'),
                            expirationdate_display: res.getText('expirationdate'),
                            manualno: res.getValue('manualno')
                        });
                        return true;
                    });
                } catch (e) {
                    log.error('Inventory Detail Search Error', e.message);
                }
            }

            // ── Search User Notes ─────────────────────────────────────────────
            let notesByIf = {};
            if (foundIfIds.length > 0) {
                let noteSearch = search.create({
                    type: 'note',
                    filters: [
                        search.createFilter({
                            name: 'internalid',
                            join: 'transaction',
                            operator: search.Operator.ANYOF,
                            values: foundIfIds
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

                    let ifId = res.getValue({ name: 'internalid', join: 'transaction' });
                    if (!notesByIf[ifId]) notesByIf[ifId] = [];

                    notesByIf[ifId].push({
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
            let filesByIf = {};
            if (foundIfIds.length > 0) {
                try {
                    let idOrFilters = [];
                    foundIfIds.forEach((id, i) => {
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

                        let ifId = res.getValue('custrecord_msi_transaction_id');
                        if (!ifId) return true;
                        if (!filesByIf[ifId]) filesByIf[ifId] = [];
                        filesByIf[ifId].push({
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

            // ── Gabungkan header + lines + inventory + notes + files ───────────
            let data = pagedHeaders.map(header => {
                let lines = linesByIf[header.id] || [];

                // Map units & inventory detail ke tiap line
                lines.forEach(line => {
                    line.units = unitsByLineKey[line.line_id] || null;
                    let invKey = `${header.id}_${line.linesequencenumber}`;
                    line.inventory_detail = inventoryByLineKey[invKey] || [];
                });

                header.lines = lines;
                header.user_notes = notesByIf[header.id] || [];
                header.files = filesByIf[String(header.id)] || [];
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
