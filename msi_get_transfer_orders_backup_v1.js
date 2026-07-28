/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Transfer Order via POST
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "trandate",
   "sort_order" : "DESC",
   "filters": {
     "id": ["12345"],
     "tranid": "TO-0001",
     "status": "B", // B, F, G
     "lastmodified": "2026-03-01T00:00:00"
   }
 }
 *
 * =============================================
 * STATUS CODES
 * B → Transfer Order : Pending Fulfillment
 * F → Transfer Order : Pending Receipt
 * G → Transfer Order : Received
 * =============================================
 */
define(['N/search', 'N/query'], function (search, query) {

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
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'lastmodifieddate' }),
                search.createColumn({ name: 'datecreated' }),
                search.createColumn({ name: 'location' }),           // from location
                search.createColumn({ name: 'transferlocation' })    // to location
            ];

            // Apply sort ke kolom yang sesuai
            for (var i = 0; i < columns.length; i++) {
                if (columns[i].name === sortColName) {
                    columns[i].sort = sortDir;
                    break;
                }
            }

            // ── Run search (header) ───────────────────────────────────────────
            var pagedData = search.create({
                type: search.Type.TRANSFER_ORDER,
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
                var fromLocId = r.getValue('location');
                var toLocId = r.getValue('transferlocation');
                map[String(r.id)] = {
                    id: String(r.id),
                    tranid: r.getValue('tranid'),
                    tran_date: r.getValue('trandate'),
                    status_code: r.getValue('status'),
                    status_name: r.getText('status'),
                    from_location_id: fromLocId ? Number(fromLocId) : null,
                    from_location_name: r.getText('location') || null,
                    to_location_id: toLocId ? Number(toLocId) : null,
                    to_location_name: r.getText('transferlocation') || null,
                    memo: r.getValue('memo') || null,
                    last_modified: formatToISO(r.getValue('lastmodifieddate')),
                    datecreated: formatToISO(r.getValue('datecreated')),
                    items: []
                };
            });

            var ids = Object.keys(map);

            // ── Line items via Search ─────────────────────────────────────────
            if (ids.length > 0) {

                // Step 1: Build status map dari Item Fulfillment & Item Receipt records
                var statusMap = {};
                search.create({
                    type: search.Type.TRANSACTION,
                    filters: [
                        ['createdfrom', 'anyof', ids],
                        'AND', ['mainline', 'is', 'F'],
                        'AND', ['taxline', 'is', 'F'],
                        'AND', ['item.type', 'noneof', '@NONE@'],
                        'AND', ['type', 'anyof', ['ItemShip', 'ItemRcpt']]
                    ],
                    columns: [
                        search.createColumn({ name: 'createdfrom', summary: search.Summary.GROUP }),
                        search.createColumn({ name: 'internalid', summary: search.Summary.GROUP }),
                        search.createColumn({ name: 'item', summary: search.Summary.GROUP }),
                        search.createColumn({ name: 'type', summary: search.Summary.GROUP }),
                        search.createColumn({ name: 'statusref', summary: search.Summary.GROUP }),
                        search.createColumn({ name: 'quantity', summary: search.Summary.MAX })
                    ]
                }).run().each(function (r) {
                    var toId = String(r.getValue({ name: 'createdfrom', summary: search.Summary.GROUP }));
                    var itemId = String(r.getValue({ name: 'item', summary: search.Summary.GROUP }));
                    var type = String(r.getValue({ name: 'type', summary: search.Summary.GROUP })).toLowerCase();
                    var status = String(r.getValue({ name: 'statusref', summary: search.Summary.GROUP })).toLowerCase();
                    var maxQty = Number(r.getValue({ name: 'quantity', summary: search.Summary.MAX })) || 0;

                    var qty = Math.abs(maxQty);
                    var key = toId + '_' + itemId;

                    if (!statusMap[key]) {
                        statusMap[key] = { picked: 0, packed: 0, fulfilled: 0, received: 0 };
                    }

                    if (type.indexOf('itemrcpt') > -1 || type.indexOf('receipt') > -1) {
                        statusMap[key].received += qty;
                    } else if (type.indexOf('itemship') > -1 || type.indexOf('fulfill') > -1) {
                        // Di NetSuite, status ini bersifat kumulatif.
                        // Jika sudah Packed (B), berarti sudah di-Picked juga.
                        // Jika sudah Shipped (C), berarti sudah di-Picked dan di-Packed.
                        if (status.indexOf('a') > -1 || status.indexOf('pick') > -1) {
                            statusMap[key].picked += qty;
                        } else if (status.indexOf('b') > -1 || status.indexOf('pack') > -1) {
                            statusMap[key].picked += qty;
                            statusMap[key].packed += qty;
                        } else if (status.indexOf('c') > -1 || status.indexOf('ship') > -1) {
                            statusMap[key].picked += qty;
                            statusMap[key].packed += qty;
                            statusMap[key].fulfilled += qty;
                        }
                    }
                    return true;
                });

                // Step 2: Query TO line items
                var lineSearch = search.create({
                    type: search.Type.TRANSFER_ORDER,
                    filters: [
                        ['internalid', 'anyof', ids],
                        'AND', ['mainline', 'is', 'F'],
                        'AND', ['taxline', 'is', 'F'],
                        'AND', ['item.type', 'noneof', '@NONE@']
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'item' }),
                        search.createColumn({ name: 'memo' }),
                        search.createColumn({ name: 'quantity' }),
                        search.createColumn({ name: 'location' })
                    ]
                });

                var seenItems = {};

                lineSearch.run().each(function (r) {
                    var toId = String(r.id);
                    if (!map[toId]) return true;

                    var itemId = r.getValue('item');
                    if (!itemId) return true;

                    var rawQty = r.getValue('quantity');
                    var qty = (rawQty !== null && rawQty !== '') ? Math.abs(Number(rawQty)) : 0;

                    var sm = statusMap[toId + '_' + String(itemId)] || { picked: 0, packed: 0, fulfilled: 0, received: 0 };

                    // qty_shipped biasanya merujuk pada jumlah yang sudah benar-benar Fulfilled/Shipped
                    var qtyShipped = sm.fulfilled;
                    // Yang committed adalah sisa barang yang belum masuk proses picking sama sekali
                    var qtyCommitted = Math.max(0, qty - sm.picked);
                    var backorder = Math.max(0, qty - qtyCommitted - sm.picked);

                    var locId = r.getValue('location');
                    var locName = r.getText('location');

                    var dedupeKey = toId + '_' + itemId + '_' + qty;
                    if (!seenItems[dedupeKey]) {
                        seenItems[dedupeKey] = true;
                        var currentLines = map[toId].items.length;
                        map[toId].items.push({
                            line_number: currentLines + 1,
                            item_id: Number(itemId),
                            item_name: r.getText('item'),
                            description: r.getValue('memo') || null,
                            quantity: qty,
                            committed: qtyCommitted,
                            shipped: qtyShipped,
                            picked: sm.picked,
                            packed: sm.packed,
                            fulfilled: sm.fulfilled,
                            received: sm.received,
                            backorder: backorder,
                            from_location_id: locId ? Number(locId) : null,
                            from_location_name: locName || null
                        });
                    }

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
                message: e.message
            };
        }
    }

    return { post: post };
});