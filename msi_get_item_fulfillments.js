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

define(['N/search', 'N/log', 'N/runtime'], (search, log, runtime) => {

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

        // ── Instrumentasi timing sementara ──────────────────────────────────
        // Script lama pun sudah cepat di sandbox tapi lambat di production —
        // dugaan volume data / governance production, bukan cuma inefisiensi
        // kode. mark() cuma log.audit tiap checkpoint ke Execution Log
        // (kelihatan walau request akhirnya timeout/gagal) — TIDAK mengubah
        // response JSON sama sekali. Hapus blok ini kalau sudah ketemu
        // bottleneck-nya.
        const __t0 = Date.now();
        let __tPrev = __t0;
        const mark = (label, extra) => {
            const now = Date.now();
            const stepMs = now - __tPrev;
            const totalMs = now - __t0;
            let remainingUsage = null;
            try { remainingUsage = runtime.getCurrentScript().getRemainingUsage(); } catch (e) { /* noop */ }
            log.audit('[TIMING] ' + label, `step=${stepMs}ms total=${totalMs}ms remainingUsage=${remainingUsage}` + (extra ? ' | ' + JSON.stringify(extra) : ''));
            __tPrev = now;
        };

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
                'createdfrom', 'postingperiod', 'lastmodifieddate', 'createdby',
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

            mark('header_search', { total_records: totalRecords, total_pages: totalPages, result_count: searchResults.length });

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
                    currency_display: res.getText('currency'),
                    created_by_id: res.getValue('createdby') ? Number(res.getValue('createdby')) : null,
                    created_by_name: res.getText('createdby') || null,
                });
            });

            mark('build_headers', { header_count: pagedHeaders.length });

            // ── Search Line Items ─────────────────────────────────────────────
            // Filter accounttype=COGS cuma valid utk IF yang baris
            // fulfillment-nya memang posting ke akun COGS (Sales Order /
            // Vendor Return). IF dari Transfer Order TIDAK pernah menyentuh
            // akun COGS (transfer antar lokasi, bukan penjualan) — kalau
            // filter ini tetap dipasang, baris TO jadi kosong semua. Jadi
            // query line-nya dipisah 2: IF non-TO (pakai accounttype COGS)
            // dan IF Transfer Order (tanpa accounttype).
            let linesByIf = {};
            // Units di-ambil langsung dari lineSearch di bawah, via join ke
            // item master ('custitem_me_unit_type') — kolom native 'units'
            // maupun 'baseunit' TIDAK valid untuk search ITEM_FULFILLMENT
            // (SSS_INVALID_SRCH_COL), pola sama seperti di
            // msi_get_transfer_orders.js. Sebelumnya bagian ini loop
            // record.load() untuk SETIAP IF di halaman (bisa 50x per
            // request) ditambah record.load per item master lagi, yang jadi
            // penyebab utama lambat/timeout di halaman dengan banyak data —
            // sekarang cukup ikut nebeng di lineSearch yang memang sudah jalan,
            // tanpa API call tambahan sama sekali.
            let unitsByLineKey = {};
            let unitsDisplayByLineKey = {};
            if (foundIfIds.length > 0) {
                const transferOrderIfIds = pagedHeaders
                    .filter(h => h.source_type === 'transfer_order')
                    .map(h => h.id);
                const salesOrderIfIds = pagedHeaders
                    .filter(h => h.source_type === 'sales_order')
                    .map(h => h.id);
                const otherIfIds = foundIfIds.filter(id =>
                    transferOrderIfIds.indexOf(id) === -1 && salesOrderIfIds.indexOf(id) === -1
                );

                const lineColumns = [
                    'internalid', 'line', 'lineuniquekey',
                    'item', 'itemtype', 'memo',
                    'quantity', 'rate',
                    'location', 'department', 'class', search.createColumn({ name: 'displayname', join: 'item' }),
                    search.createColumn({ name: 'custitem_me_unit_type', join: 'item' }),
                    // Inventory detail (lot/serial) di-ambil via join langsung
                    // ke sini juga — search type terpisah 'inventorydetail'
                    // dengan kolom 'line' TIDAK valid (SSS_INVALID_SRCH_COL);
                    // pola join 'inventorydetail' ini yang sudah terbukti jalan
                    // di msi_get_customer_returns.js. Join 1:N ini bikin baris
                    // hasil search "fan-out" (1 baris per lot/serial) — lihat
                    // penanganannya di pushLine (lineByKey).
                    // Catatan: 'expirationdate' & 'manualno' TIDAK valid sebagai
                    // join column ke 'inventorydetail' (SSS_INVALID_SRCH_COL,
                    // sama kayak 'baseunit' di item join) — cuma 'inventorynumber'
                    // & 'quantity' yang terbukti jalan (dipakai juga di
                    // msi_get_customer_returns.js).
                    search.createColumn({ name: 'inventorynumber', join: 'inventorydetail' }),
                    search.createColumn({ name: 'quantity', join: 'inventorydetail' })
                ];

                // Key: lineuniquekey (unik global) -> objek line yang sudah
                // di-push ke linesByIf. Dipakai supaya baris fan-out dari join
                // inventorydetail (1 line bisa py beberapa lot/serial) tidak
                // bikin duplikat line, cuma nambah ke inventory_detail array.
                const lineByKey = {};

                const pushLine = res => {
                    let ifId = res.getValue('internalid');
                    if (!linesByIf[ifId]) linesByIf[ifId] = [];

                    const lineUniqueKey = res.getValue('lineuniquekey');
                    const lk = lineUniqueKey ? String(lineUniqueKey) : null;

                    if (lk && !unitsByLineKey[lk] && !unitsDisplayByLineKey[lk]) {
                        const unitVal = res.getValue({ name: 'custitem_me_unit_type', join: 'item' });
                        const unitText = res.getText({ name: 'custitem_me_unit_type', join: 'item' });
                        if (unitVal || unitText) {
                            unitsByLineKey[lk] = (unitVal !== null && unitVal !== undefined && unitVal !== '') ? unitVal : unitText;
                            unitsDisplayByLineKey[lk] = unitText || null;
                        }
                    }

                    let line = lk ? lineByKey[lk] : null;
                    if (!line) {
                        line = {
                            transaction: ifId,
                            linesequencenumber: Number(res.getValue('line')),
                            line_id: res.getValue('lineuniquekey'),
                            item: res.getValue('item'),
                            item_display: res.getText('item'),
                            item_displayname: res.getValue({ name: 'displayname', join: 'item' }),
                            itemtype: res.getValue('itemtype'),
                            memo: res.getValue('memo'),
                            quantity: Number(res.getValue('quantity')),
                            rate: res.getValue('rate') ? Number(res.getValue('rate')) : 0,
                            // currency diisi belakangan dari header (field header,
                            // bukan per-line) — lihat blok penggabungan header+lines.
                            currency: null,
                            currency_display: null,
                            // units diisi belakangan: prioritas dari kolom 'units'
                            // hasil lineSearch (unitsByLineKey), lalu fallback base
                            // unit item master untuk baris yang kolom unit-nya
                            // kosong di search (umumnya IF dari Transfer Order).
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
                            class_display: res.getText('class'),
                            inventory_detail: []
                        };
                        linesByIf[ifId].push(line);
                        if (lk) lineByKey[lk] = line;
                    }

                    const invNum = res.getValue({ name: 'inventorynumber', join: 'inventorydetail' });
                    const invNumText = res.getText({ name: 'inventorynumber', join: 'inventorydetail' });
                    const invQty = res.getValue({ name: 'quantity', join: 'inventorydetail' });
                    if (invNum || invNumText || invQty) {
                        line.inventory_detail.push({
                            inventorynumber_id: invNum,
                            inventorynumber_text: invNumText,
                            lotnumber: invNumText,
                            quantity: invQty,
                        });
                    }
                    return true;
                };

                const runLineSearch = (ids, filters) => {
                    if (ids.length === 0) return;
                    let lineSearch = search.create({
                        type: search.Type.ITEM_FULFILLMENT,
                        filters: [['internalid', 'anyof', ids], 'AND', ['mainline', 'is', 'F']].concat(filters),
                        columns: lineColumns
                    });
                    fetchSearchResults(lineSearch, pushLine);
                };

                // Sales Order: baris fulfillment yang posting ke akun COGS,
                // dipersempit lagi ke IF yang benar-benar dibuat dari Sales
                // Order (createdfrom.type).
                runLineSearch(salesOrderIfIds, [
                    'AND', ['accounttype', 'anyof', 'COGS'],
                    'AND', ['taxline', 'is', 'F'],
                    'AND', ['shipping', 'is', 'F'],
                    'AND', ['createdfrom.type', 'anyof', 'SalesOrd']
                ]);

                // Non-TO lainnya (Vendor Return, dll): baris fulfillment yang
                // posting ke akun COGS, tanpa pembatasan createdfrom.type.
                runLineSearch(otherIfIds, [
                    'AND', ['accounttype', 'anyof', 'COGS'],
                    'AND', ['taxline', 'is', 'F'],
                    'AND', ['shipping', 'is', 'F']
                ]);

                // Transfer Order: field 'accounttype'/'taxline'/'shipping' di
                // atas tidak berlaku sama sekali (TO tidak menyentuh akun
                // COGS) — dipakai kombinasi qty >= 0 (buang baris cermin
                // negatif) + flag 'cogs' checkbox di transactionline.
                runLineSearch(transferOrderIfIds, [
                    'AND', ['formulanumeric: {quantity}', 'greaterthanorequalto', '0'],
                    'AND', ['cogs', 'is', 'T']
                ]);
            }

            mark('line_search', {
                line_count: Object.keys(linesByIf).reduce((sum, k) => sum + linesByIf[k].length, 0),
                inventory_detail_row_count: Object.keys(linesByIf).reduce(
                    (sum, k) => sum + linesByIf[k].reduce((s2, l) => s2 + l.inventory_detail.length, 0), 0
                )
            });

            // ── (dihapus) Search Inventory Detail per Line ──────────────────────
            // Sebelumnya search terpisah type:'inventorydetail' di sini — selain
            // kolom 'line'-nya invalid (SSS_INVALID_SRCH_COL) di production,
            // datanya sekarang sudah diambil langsung via join di lineSearch di
            // atas (lihat pushLine), jadi blok search + 1 API call ini hilang
            // total.

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

            mark('notes_search', {
                note_count: Object.keys(notesByIf).reduce((sum, k) => sum + notesByIf[k].length, 0)
            });

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

            mark('files_search', {
                file_count: Object.keys(filesByIf).reduce((sum, k) => sum + filesByIf[k].length, 0)
            });

            // ── Fallback Units dari Item Master ──────────────────────────────
            // IF yang dibuat dari Transfer Order sering TIDAK menyimpan unit di
            // barisnya (kolom units kosong di record & search), padahal UI
            // menampilkan base unit item (mis. "PCS"). Kalau sampai di sini
            // units masih kosong, ambil base unit dari item master.
            // Disimpan 2 hal: itemBaseUnitIdById (internal ID unit) dan
            // itemBaseUnitLabelById (label/abbr unit) — supaya response
            // konsisten: units = ID, units_display = label (pola sama seperti
            // location/location_display & msi_get_inventory_adjustments.js).
            //
            // PENTING: sebelumnya ini record.load() SATU-SATU per item unik —
            // di production baris per-IF bisa ratusan (order besar), jadi item
            // unik yang butuh fallback juga bisa ratusan → governance/usage
            // limit (5000 unit) jebol di tengah jalan ("Script Execution Usage
            // Limit Exceeded" lalu request keburu mati dgn ScriptNullObjectAdapter).
            // Sekarang diganti search massal per tipe item (dikelompokkan dulu,
            // 1 search per tipe, bukan per item) — pola sama seperti blok
            // "On Hand per Line" di bawah.
            let itemBaseUnitIdById = {};
            let itemBaseUnitLabelById = {};
            if (Object.keys(linesByIf).length > 0) {
                const itemTypeToSearchType = (t) => {
                    switch (t) {
                        case 'InvtPart':    return search.Type.INVENTORY_ITEM;
                        case 'NonInvtPart': return search.Type.NON_INVENTORY_ITEM;
                        case 'Serialized':  return search.Type.SERIALIZED_INVENTORY_ITEM;
                        case 'Lot':         return search.Type.LOT_NUMBERED_INVENTORY_ITEM;
                        case 'Kit':         return search.Type.KIT;
                        default:            return search.Type.INVENTORY_ITEM;
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

                // Kelompokkan item unik yang butuh fallback per search type,
                // supaya bisa 1 search per type (bukan per item).
                const itemIdsByType = {};
                needFallback.forEach(l => {
                    const st = itemTypeToSearchType(l.itemtype);
                    if (!itemIdsByType[st]) itemIdsByType[st] = [];
                    itemIdsByType[st].push(l.item);
                });

                Object.keys(itemIdsByType).forEach(st => {
                    const itemIds = itemIdsByType[st];
                    if (itemIds.length === 0) return;
                    try {
                        // 'baseunit' TIDAK valid sebagai search column di akun
                        // ini (SSS_INVALID_SRCH_COL, baik native maupun join),
                        // jadi cuma pakai 'custitem_me_unit_type' — sama seperti
                        // di lineSearch utama & msi_get_transfer_orders.js.
                        const unitSearch = search.create({
                            type: st,
                            filters: [['internalid', 'anyof', itemIds]],
                            columns: [
                                search.createColumn({ name: 'internalid' }),
                                search.createColumn({ name: 'custitem_me_unit_type' })
                            ]
                        });
                        // fetchSearchResults (getRange) dipakai, bukan
                        // '.run().each()' — .each() dibatasi maks 4000 hasil.
                        fetchSearchResults(unitSearch, r => {
                            const itemId = r.getValue('internalid');
                            const unitVal = r.getValue('custitem_me_unit_type');
                            const unitLabel = r.getText('custitem_me_unit_type');
                            itemBaseUnitIdById[itemId] = (unitVal || unitLabel) || null;
                            itemBaseUnitLabelById[itemId] = unitLabel || null;
                            return true;
                        });
                    } catch (e) {
                        log.error('Item Unit Search Error (' + st + ')', e.message);
                    }
                });

                mark('units_item_fallback', { fallback_item_count: needFallback.length });
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
                        // '.run().each()' dibatasi maks 4000 hasil oleh NetSuite
                        // dan bikin request ini gagal di data besar (item x lokasi
                        // unik bisa lewat 4000 kombinasi) — pakai fetchSearchResults
                        // (getRange, gak kena batas itu) sama seperti blok lain.
                        fetchSearchResults(invSearch, r => {
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

            mark('on_hand_search', { on_hand_key_count: Object.keys(onHandByItemLoc).length });

            // ── Gabungkan header + lines + inventory + notes + files ───────────
            let data = pagedHeaders.map(header => {
                let rawLines = linesByIf[header.id] || [];

                // Filter lineSearch di atas (mainline F + accounttype COGS +
                // taxline F + shipping F) sudah membuang baris tax/shipping/
                // cermin non-COGS, jadi hasilnya sudah 1 baris per baris UI —
                // dedupe by line_id di sini cuma jaga-jaga (harusnya
                // lineuniquekey sudah unik per baris).
                const seenLineId = {};
                let lines = [];
                rawLines.forEach(l => {
                    const k = String(l.line_id);
                    if (!seenLineId[k]) { seenLineId[k] = true; lines.push(l); }
                });

                // ── Urutkan & beri nomor berurutan 1..N sesuai urutan UI,
                // lalu map units per baris. Inventory detail sudah menempel
                // langsung di line object dari pushLine (lihat lineSearch).
                lines.sort((a, b) => a.linesequencenumber - b.linesequencenumber);
                lines.forEach((line, idx) => {
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

            mark('merge');

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
