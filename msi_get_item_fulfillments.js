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
                'datecreated', 'incoterm', 'currency',
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
                    datecreated: formatToISO(res.getValue('datecreated')),
                    incoterm_id: res.getValue('incoterm'),
                    incoterm_name: res.getText('incoterm') || null,
                    currency: res.getValue('currency'),
                    currency_display: res.getText('currency')
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
                        'quantity', 'rate',
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
                        quantity: Number(res.getValue('quantity')),
                        rate: res.getValue('rate') ? Number(res.getValue('rate')) : 0,
                        // currency diisi belakangan dari header (field header,
                        // bukan per-line) — lihat blok penggabungan header+lines.
                        currency: null,
                        currency_display: null,
                        // units diisi belakangan: prioritas dari record sublist
                        // 'item' (unitsByLineKey), lalu fallback base unit item
                        // master — kolom unit tidak dijamin valid di saved search
                        // ITEM_FULFILLMENT.
                        units: null,
                        units_display: null,
                        // On Hand diisi belakangan via inventory lookup per
                        // (item + lokasi) — lihat blok "On Hand per Line".
                        on_hand: null,
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
            // Sekaligus kumpulkan baris yang benar-benar tampil di record
            // sublist 'item' (= baris asli yang terlihat di UI), dalam 2 bentuk:
            //   recordLineKeysByIf[ifId]  → lineuniquekey (String)
            //   recordLineNumsByIf[ifId]  → nomor line tersimpan (Number)
            // Baris internal/phantom — mis. IF hasil fulfill Transfer Order,
            // di mana 1 baris UI tersimpan s.d. 3 sub-row di transactionline
            // (+qty / -qty / +qty, pola sama seperti msi_get_transfer_orders.js) —
            // dipakai sebagai acuan untuk membuang baris duplikat dari hasil
            // saved search. Dua bentuk dicatat karena domain nilai antara
            // hasil search vs record API bisa saja berbeda.
            let unitsByLineKey = {};
            let unitsDisplayByLineKey = {};
            let recordLineKeysByIf = {};
            let recordLineNumsByIf = {};
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
                            if (!recordLineNumsByIf[ifId]) recordLineNumsByIf[ifId] = [];
                            if (lineNum !== null && lineNum !== undefined && lineNum !== '') {
                                recordLineNumsByIf[ifId].push(Number(lineNum));
                            }
                            if (lineUniqueKey) {
                                if (!recordLineKeysByIf[ifId]) recordLineKeysByIf[ifId] = [];
                                recordLineKeysByIf[ifId].push(String(lineUniqueKey));
                                // Simpan key sebagai String agar konsisten dengan
                                // line_id dari saved search (sebelumnya key Number
                                // vs lookup String → units selalu null).
                                const lk = String(lineUniqueKey);
                                unitsByLineKey[lk] = ifRecord.getSublistValue({
                                    sublistId: 'item',
                                    fieldId: 'units',
                                    line: i
                                }) || null;
                                unitsDisplayByLineKey[lk] = ifRecord.getSublistText({
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

            // ── Fallback Units dari Item Master ──────────────────────────────
            // IF yang dibuat dari Transfer Order sering TIDAK menyimpan unit di
            // barisnya (kolom units kosong di record & search), padahal UI
            // menampilkan base unit item (mis. "PCS"). Kalau sampai di sini
            // units masih kosong, ambil base unit dari item master.
            // Disimpan 2 hal: itemBaseUnitIdById (internal ID unit) dan
            // itemBaseUnitLabelById (label/abbr unit) — supaya response
            // konsisten: units = ID, units_display = label (pola sama seperti
            // location/location_display & msi_get_inventory_adjustments.js).
            let itemBaseUnitIdById = {};
            let itemBaseUnitLabelById = {};
            if (Object.keys(linesByIf).length > 0) {
                const itemTypeToRecordType = (t) => {
                    switch (t) {
                        case 'InvtPart':    return record.Type.INVENTORY_ITEM;
                        case 'NonInvtPart': return record.Type.NON_INVENTORY_ITEM;
                        case 'Serialized':  return record.Type.SERIALIZED_INVENTORY_ITEM;
                        case 'Lot':         return record.Type.LOT_NUMBERED_INVENTORY_ITEM;
                        case 'Kit':         return record.Type.KIT;
                        default:            return null;
                    }
                };

                const needFallback = [];
                const seenItem = {};
                Object.keys(linesByIf).forEach(ifId => {
                    linesByIf[ifId].forEach(l => {
                        // Punya unit dari record sublist → tidak perlu fallback
                        if (unitsByLineKey[String(l.line_id)] || unitsDisplayByLineKey[String(l.line_id)]) return;
                        if (l.units || l.units_display) return;
                        if (!l.item || seenItem[l.item]) return;
                        seenItem[l.item] = true;
                        needFallback.push(l);
                    });
                });

                needFallback.forEach(l => {
                    const itemId = l.item;
                    try {
                        const recType = itemTypeToRecordType(l.itemtype) || record.Type.INVENTORY_ITEM;
                        const itemRec = record.load({ type: recType, id: itemId });

                        // Coba field baseunit dulu (standar, value = internal ID
                        // unit, text = label/abbr), lalu custitem_me_unit_type.
                        let unitVal = null;
                        let unitLabel = null;
                        ['baseunit', 'custitem_me_unit_type'].forEach(f => {
                            if (unitLabel) return;
                            try {
                                const v = itemRec.getValue({ fieldId: f });
                                const t = itemRec.getText({ fieldId: f });
                                if (t) {
                                    unitVal = (v !== null && v !== undefined && v !== '') ? String(v) : t;
                                    unitLabel = t;
                                }
                            } catch (e) { /* field mungkin tidak tersedia di tipe item ini */ }
                        });

                        itemBaseUnitIdById[itemId] = unitVal;
                        itemBaseUnitLabelById[itemId] = unitLabel;
                    } catch (e) {
                        log.error('Item Load Error for unit fallback item ' + itemId, e.message);
                        itemBaseUnitIdById[itemId] = null;
                        itemBaseUnitLabelById[itemId] = null;
                    }
                });
            }

            // ── On Hand per Line (qty di lokasi baris) ──────────────────────
            // On hand hanya relevan untuk item inventory (InvtPart / Serialized /
            // Lot) dan bersifat per-lokasi. Pola sama seperti
            // msi_get_sales_orders.js: search item + join inventorylocation,
            // kolom locationquantityonhand.
            let onHandByItemLoc = {};
            if (Object.keys(linesByIf).length > 0) {
                const itemTypeToSearchType = (t) => {
                    switch (t) {
                        case 'InvtPart':   return search.Type.INVENTORY_ITEM;
                        case 'Serialized': return search.Type.SERIALIZED_INVENTORY_ITEM;
                        case 'Lot':        return search.Type.LOT_NUMBERED_INVENTORY_ITEM;
                        default:           return null; // NonInvtPart/Kit/Service dll → tanpa on hand
                    }
                };

                // Kumpulkan (tipe item, itemId, locationId) unik dari semua baris
                const typeItems = {}; // key: search type -> { items: {}, locations: {} }
                Object.keys(linesByIf).forEach(ifId => {
                    linesByIf[ifId].forEach(l => {
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

            // ── Gabungkan header + lines + inventory + notes + files ───────────
            let data = pagedHeaders.map(header => {
                let rawLines = linesByIf[header.id] || [];
                const recKeys = recordLineKeysByIf[header.id] || [];
                const recLineNums = recordLineNumsByIf[header.id] || [];
                const isTransfer = header.source_type === 'transfer_order';

                // ── Langkah 1: buang duplikat eksak (jaga-jaga, seharusnya
                // lineuniquekey hasil search unik per baris).
                const seenLineId = {};
                let lines = [];
                rawLines.forEach(l => {
                    const k = String(l.line_id);
                    if (!seenLineId[k]) { seenLineId[k] = true; lines.push(l); }
                });

                // ── Langkah 2: ciutkan baris "phantom"/cermin bawaan NetSuite.
                // Di transactionline, 1 baris item UI bisa tersimpan 2-3 sub-row:
                // pasangan +/- ber-|qty| sama (mis. +7/-7), atau +q/-q/+q (khas
                // Transfer Order, pola sama seperti msi_get_transfer_orders.js).
                // Baris cermin selalu disertai baris qty NEGATIF. Dedupe aman:
                //   - grup mengandung baris negatif → collapse per |qty| unik,
                //     satu baris wakil per |qty| (prefer qty positif > cocok
                //     record sublist > qty absolut terbesar > line terkecil).
                //   - grup semua positif → baris asli berbeda → pertahankan semua
                //     (kecuali khas TO: duplikat +q/+q tanpa baris negatif).
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

                    const recKeySet = {};
                    recKeys.forEach(k => { recKeySet[String(k)] = true; });
                    const recLineSet = {};
                    recLineNums.forEach(n => { recLineSet[Number(n)] = true; });
                    const inRec = l => recKeySet[String(l.line_id)] || recLineSet[Number(l.linesequencenumber)];

                    // pilih wakil terbaik di antara dua baris
                    const pickBest = (a, b) => {
                        const aQty = Number(a.quantity) || 0;
                        const bQty = Number(b.quantity) || 0;
                        const aPos = aQty > 0, bPos = bQty > 0;
                        if (aPos && !bPos) return a;
                        if (!aPos && bPos) return b;
                        const aRec = inRec(a), bRec = inRec(b);
                        if (aRec && !bRec) return a;
                        if (!aRec && bRec) return b;
                        if (Math.abs(aQty) > Math.abs(bQty)) return a;
                        if (Math.abs(aQty) < Math.abs(bQty)) return b;
                        return Number(a.linesequencenumber) <= Number(b.linesequencenumber) ? a : b;
                    };

                    const collapsed = [];
                    groupOrder.forEach(gk => {
                        const group = groupMap[gk];
                        if (group.length === 1) { collapsed.push(group[0]); return; }

                        const negCount = group.filter(l => Number(l.quantity) < 0).length;
                        const absQtySet = {};
                        group.forEach(l => { absQtySet[Math.abs(Number(l.quantity))] = true; });
                        const duplicateAbs = Object.keys(absQtySet).length < group.length;

                        // Grup semua positif & bukan duplikat absolut khas TO →
                        // baris asli yang berbeda → pertahankan semua.
                        if (negCount === 0 && !(isTransfer && duplicateAbs)) {
                            group.forEach(l => collapsed.push(l));
                            return;
                        }

                        // Ada baris cermin/negatif (atau duplikat absolut TO):
                        // pilih SATU wakil per |qty| unik.
                        const byAbs = {};
                        const absOrder = [];
                        group.forEach(l => {
                            const a = Math.abs(Number(l.quantity));
                            if (!byAbs[a]) { byAbs[a] = l; absOrder.push(a); }
                            else byAbs[a] = pickBest(byAbs[a], l);
                        });
                        absOrder.forEach(a => collapsed.push(byAbs[a]));
                    });
                    lines = collapsed;
                }

                // ── Langkah 3: urutkan & beri nomor berurutan 1..N sesuai
                // urutan UI, lalu map units & inventory detail per baris.
                // Key inventory detail memakai nomor baris ASLI di
                // transactionline (diambil sebelum renumber).
                lines.sort((a, b) => a.linesequencenumber - b.linesequencenumber);
                lines.forEach((line, idx) => {
                    const rawSeq = line.linesequencenumber;
                    line.linesequencenumber = idx + 1;

                    // Units: prioritas → unit dari record sublist 'item'
                    // (value + text), lalu base unit item master (fallback).
                    // Konvensi: units = internal ID unit, units_display = label
                    // (mis. units: "1", units_display: "PCS").
                    const recUnit = unitsByLineKey[String(line.line_id)];
                    const recUnitText = unitsDisplayByLineKey[String(line.line_id)];
                    if (recUnit) {
                        line.units = recUnit;
                        if (recUnitText) line.units_display = recUnitText;
                    } else if (recUnitText) {
                        // Hanya ada label di record → label dipakai di kedua field
                        // (mencegah units_display null saat value tidak tersedia).
                        line.units = recUnitText;
                        line.units_display = recUnitText;
                    }
                    if (!line.units && itemBaseUnitLabelById[line.item]) {
                        line.units = itemBaseUnitIdById[line.item] || itemBaseUnitLabelById[line.item];
                        line.units_display = itemBaseUnitLabelById[line.item];
                    }

                    // On Hand: qty on hand di lokasi baris (khusus item
                    // inventory). Key: itemId_locationId.
                    const itemLocKey = (line.item && line.location !== null && line.location !== undefined && line.location !== '')
                        ? String(line.item) + '_' + String(line.location)
                        : '';
                    const ohData = itemLocKey ? onHandByItemLoc[itemLocKey] : null;
                    if (ohData !== null && ohData !== undefined) {
                        line.on_hand = ohData;
                    }

                    const invKey = `${header.id}_${rawSeq}`;
                    line.inventory_detail = inventoryByLineKey[invKey] || [];

                    // Currency bukan field per-line di Item Fulfillment,
                    // tapi field header transaksi — dipasang ke tiap baris
                    // supaya UI (khusus tipe vendor_return) bisa tampilkan
                    // kolom Rate + Currency langsung dari data line.
                    line.currency = header.currency;
                    line.currency_display = header.currency_display;
                });

                if (rawLines.length > 0 && lines.length !== rawLines.length) {
                    log.audit('IF Line Dedupe', `IF ${header.id} (${header.source_type}): ${rawLines.length} search line -> ${lines.length} line`);
                }

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
