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
            var day    = parseInt(m1[1]);
            var month  = parseInt(m1[2]);
            var year   = parseInt(m1[3]);
            var hour   = parseInt(m1[4]);
            var minute = parseInt(m1[5]);
            var ampm   = m1[6].toUpperCase();

            if (ampm === 'PM' && hour !== 12) hour += 12;
            if (ampm === 'AM' && hour === 12) hour = 0;

            return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+07:00`;
        }

        // =========================
        // 2. FORMAT: DD/MM/YYYY (tanpa jam)
        // =========================
        var shortRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        var m2 = dateStr.match(shortRegex);

        if (m2) {
            var day   = parseInt(m2[1]);
            var month = parseInt(m2[2]);
            var year  = parseInt(m2[3]);

            return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00+07:00`;
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

            var page      = context.page       || 1;
            var pageSize  = context.page_size  || 20;
            var sortBy    = context.sort_by    || 'trandate';
            var sortOrder = context.sort_order || 'DESC';
            var filters   = context.filters    || {};

            // ── Sort mapping ──────────────────────────────────────────────────
            var sortMap = {
                'trandate'        : 'trandate',
                'lastmodifieddate': 'lastmodifieddate',
                'tranid'          : 'tranid'
            };
            var sortColName = sortMap[sortBy] || 'trandate';
            var sortDir     = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            // ── Build filters ─────────────────────────────────────────────────
            var searchFilters = [
                ['mainline', 'is', 'T']
            ];

            if (filters.lastmodified) {
                var d = new Date(filters.lastmodified);
                var nsDate = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            // ── Build columns ─────────────────────────────────────────────────
            var columns = [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'trandate' }),
                search.createColumn({ name: 'status' }),
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

            // ── Run search (header) ───────────────────────────────────────────
            var pagedData = search.create({
                type   : search.Type.TRANSFER_ORDER,
                filters: searchFilters,
                columns: columns
            }).runPaged({ pageSize: pageSize });

            var totalRecords = pagedData.count;
            var totalPages   = pagedData.pageRanges.length;

            if (totalRecords === 0 || page > totalPages) {
                return {
                    status       : 'success',
                    page         : page,
                    page_size    : pageSize,
                    total_records: totalRecords,
                    total_pages  : totalPages,
                    data         : []
                };
            }

            var pageResult = pagedData.fetch({ index: page - 1 });

            // ── Build map dari hasil header search ────────────────────────────
            var map = {};
            pageResult.data.forEach(function (r) {
                map[String(r.id)] = {
                    id                : String(r.id),
                    tranid            : r.getValue('tranid'),
                    tran_date         : r.getValue('trandate'),
                    status_code       : r.getValue('status'),
                    status_name       : r.getText('status'),
                    from_location_id  : null,
                    from_location_name: null,
                    to_location_id    : null,
                    to_location_name  : null,
                    memo              : r.getValue('memo') || null,
                    last_modified     : formatToISO(r.getValue('lastmodifieddate')),
                    datecreated       : formatToISO(r.getValue('datecreated')),
                    items             : []
                };
            });

            var ids = Object.keys(map);

            // ── Line items via SuiteQL ────────────────────────────────────────
            // SuiteQL dipakai untuk lines karena location deduce logic butuh raw data
            if (ids.length > 0) {
                var placeholders = ids.join(',');

                var lineSql = `
                    SELECT
                        tl.transaction              AS to_id,
                        tl.linesequencenumber       AS line_number,
                        tl.item                     AS item_id,
                        BUILTIN.DF(tl.item)         AS item_name,
                        tl.memo                     AS description,
                        ABS(tl.quantity)            AS quantity,
                        tl.location                 AS from_location_id,
                        BUILTIN.DF(tl.location)     AS from_location_name
                    FROM transactionline tl
                    WHERE tl.transaction IN (${placeholders})
                    AND tl.mainline = 'F'
                    AND tl.taxline  = 'F'
                    AND tl.itemtype IS NOT NULL
                    ORDER BY tl.transaction, tl.id
                `;

                var lineResult = query.runSuiteQL({ query: lineSql }).asMappedResults();

                var seenItems = {};

                lineResult.forEach(function (l) {
                    var toId = String(l.to_id);
                    if (!map[toId]) return;

                    // Deduce Header Locations from lines dynamically
                    if (!map[toId].from_location_id) {
                        map[toId].from_location_id   = l.from_location_id;
                        map[toId].from_location_name = l.from_location_name;
                    } else if (map[toId].from_location_id != l.from_location_id && !map[toId].to_location_id) {
                        map[toId].to_location_id   = l.from_location_id;
                        map[toId].to_location_name = l.from_location_name;
                    }

                    // Filter out Destination/Receiving Lines from the Items Array
                    if (map[toId].from_location_id && map[toId].from_location_id != l.from_location_id) {
                        return; // Skip receiving line
                    }

                    // Deduplicate identical items (due to NetSuite's shipping/commitment double lines)
                    var dedupeKey = toId + '_' + l.item_id + '_' + l.quantity;
                    if (!seenItems[dedupeKey]) {
                        var currentLines = map[toId].items.length;
                        map[toId].items.push({
                            line_number       : currentLines + 1,
                            item_id           : l.item_id,
                            item_name         : l.item_name,
                            description       : l.description,
                            quantity          : l.quantity,
                            from_location_id  : l.from_location_id,
                            from_location_name: l.from_location_name
                        });
                        seenItems[dedupeKey] = true;
                    }
                });
            }

            var data = ids.map(function (k) { return map[k]; });

            return {
                status       : 'success',
                page         : page,
                page_size    : pageSize,
                total_records: totalRecords,
                total_pages  : totalPages,
                data         : data
            };

        } catch (e) {
            return {
                status : 'error',
                message: e.message
            };
        }
    }

    return { post: post };
});