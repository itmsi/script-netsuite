/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Vendor Return (Return Authorization) via POST
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "trandate",
   "sort_order" : "DESC",
   "filters": {
     "id": ["12345"],
     "tranid": "VR-0001",
     "lastmodified": "2026-12-16T23:59:00"
   }
 }
 *
 * =============================================
 * STATUS CODES
 * status_code | status_name
 * ------------|------------------------------------------
 A           | Vendor Return Authorization : Pending Approval
 B           | Vendor Return Authorization : Open
 C           | Vendor Return Authorization : Cancelled
 D           | Vendor Return Authorization : Rejected
 E           | Vendor Return Authorization : Partially Applied
 F           | Vendor Return Authorization : Pending Credit
 G           | Vendor Return Authorization : Credited
 * =============================================
 */
define(['N/search'], function (search) {

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

            if (ampm === 'PM' && hour !== 12) hour += 12;
            if (ampm === 'AM' && hour === 12) hour = 0;

            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;
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

            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+07:00`;
        }

        // =========================
        // 3. FALLBACK
        // =========================
        var d = new Date(dateStr);
        if (isNaN(d)) return dateStr;

        return d.toISOString();
    }

    function post(context) {
        try {

            var page = context.page || 1;
            var pageSize = context.page_size || 20;
            var sortBy = context.sort_by || 'trandate';
            var sortOrder = context.sort_order || 'DESC';
            var filters = context.filters || {};

            // ── Sort mapping ──────────────────────────────────────────────────
            var sortMap = {
                'trandate': 'trandate',
                'lastmodifieddate': 'lastmodifieddate',
                'tranid': 'tranid'
            };
            var sortColName = sortMap[sortBy] || 'trandate';
            var sortDir = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            // ── Build filters ─────────────────────────────────────────────────
            var searchFilters = [
                ['type', 'anyof', 'VendAuth'],
                'AND',
                ['mainline', 'is', 'T']
            ];

            if (filters.lastmodified) {
                var d = new Date(filters.lastmodified);
                var nsDate = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            if (filters.id || filters.internalid) {
                searchFilters.push('AND', ['internalid', 'anyof', filters.id || filters.internalid]);
            }

            if (filters.tranid) {
                searchFilters.push('AND', ['tranid', 'is', filters.tranid]);
            }

            // ── Build columns ─────────────────────────────────────────────────
            var columns = [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'trandate' }),
                search.createColumn({ name: 'status' }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'lastmodifieddate' }),
                search.createColumn({ name: 'datecreated' })
            ];

            // Apply sort ke kolom yang sesuai
            for (var i = 0; i < columns.length; i++) {
                if (columns[i].name === sortColName) {
                    columns[i].sort = sortDir;
                    break;
                }
            }

            // ── Run search ────────────────────────────────────────────────────
            var pagedData = search.create({
                type: search.Type.TRANSACTION,
                filters: searchFilters,
                columns: columns
            }).runPaged({ pageSize: pageSize });

            var totalRecords = pagedData.count;
            var totalPages = pagedData.pageRanges.length;

            if (totalRecords === 0 || page > totalPages) {
                return {
                    status: 'success',
                    page: page,
                    page_size: pageSize,
                    total_records: totalRecords,
                    total_pages: totalPages,
                    data: []
                };
            }

            var pageResult = pagedData.fetch({ index: page - 1 });

            // ── Build map dari hasil header search ────────────────────────────
            var map = {};
            pageResult.data.forEach(function (r) {
                map[String(r.id)] = {
                    id: String(r.id),
                    tranid: r.getValue('tranid'),
                    vendor_id: r.getValue('entity') || null,
                    vendor_name: r.getText('entity') || null,
                    tran_date: r.getValue('trandate'),
                    status_code: r.getValue('status'),
                    status_name: r.getText('status'),
                    memo: r.getValue('memo') || null,
                    last_modified: formatToISO(r.getValue('lastmodifieddate')),
                    datecreated: formatToISO(r.getValue('datecreated')),
                    items: []
                };
            });

            var ids = Object.keys(map);

            if (ids.length > 0) {
                var lineSearch = search.create({
                    type: search.Type.TRANSACTION,
                    filters: [
                        ['internalid', 'anyof', ids],
                        'AND', ['mainline', 'is', 'F'],
                        'AND', ['taxline', 'is', 'F'],
                        'AND', ['shipping', 'is', 'F'],
                        'AND', ['item.type', 'noneof', '@NONE@']
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'item' }),
                        search.createColumn({ name: 'memo' }),
                        search.createColumn({ name: 'quantity' }),
                        search.createColumn({ name: 'quantityshiprecv' }), // fulfilled/shipped
                        search.createColumn({ name: 'rate' }),
                        search.createColumn({ name: 'amount' }),
                        search.createColumn({ name: 'location' })
                    ]
                });

                lineSearch.run().each(function (r) {
                    var vrId = String(r.id);
                    if (!map[vrId]) return true;

                    var itemId = r.getValue('item');
                    if (!itemId) return true;

                    var rawQty = r.getValue('quantity');
                    var qty = (rawQty !== null && rawQty !== '') ? Math.abs(Number(rawQty)) : 0;

                    var receivedQty = r.getValue('quantityshiprecv');
                    var received = (receivedQty !== null && receivedQty !== '') ? Math.abs(Number(receivedQty)) : 0;

                    var committed = Math.max(0, qty - received);
                    var backorder = Math.max(0, qty - committed - received);

                    var currentLines = map[vrId].items.length;

                    map[vrId].items.push({
                        line_number: currentLines + 1,
                        item_id: Number(itemId),
                        item_name: r.getText('item'),
                        description: r.getValue('memo') || null,
                        quantity: qty,
                        committed: committed,
                        backorder: backorder,
                        received: received,
                        rate: r.getValue('rate') ? Number(r.getValue('rate')) : 0,
                        amount: r.getValue('amount') ? Number(r.getValue('amount')) : 0,
                        location_id: r.getValue('location') ? Number(r.getValue('location')) : null,
                        location_name: r.getText('location') || null
                    });

                    return true;
                });
            }

            var data = ids.map(function (k) { return map[k]; });

            return {
                status: 'success',
                page: page,
                page_size: pageSize,
                total_records: totalRecords,
                total_pages: totalPages,
                data: data
            };

        } catch (e) {
            return {
                status: 'error',
                message: e.message || JSON.stringify(e)
            };
        }
    }

    return { post: post };
});
