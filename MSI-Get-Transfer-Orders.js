/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/query', 'N/log'], function (query, log) {

    function post(context) {
        try {

            // =========================
            // 🔥 DEFAULT PARAM
            // =========================
            var page       = context.page || 1;
            var pageSize   = context.page_size || 20;
            var sortBy     = context.sort_by || 'trandate';
            var sortOrder  = context.sort_order || 'DESC';
            var filters    = context.filters || {};

            var offset = (page - 1) * pageSize;

            // =========================
            // 🔥 VALIDASI SORT (BIAR AMAN)
            // =========================
            var allowedSort = [
                'trandate',
                'lastmodifieddate',
                'tranid'
            ];

            if (allowedSort.indexOf(sortBy) === -1) {
                sortBy = 'trandate';
            }

            sortOrder = (sortOrder === 'ASC') ? 'ASC' : 'DESC';

            // =========================
            // 🔥 FILTER BUILDER
            // =========================
            var whereClause = `WHERE t.type = 'TrnfrOrd'`;

            if (filters.lastmodified) {
                whereClause += ` 
                    AND t.lastmodifieddate >= TO_DATE('${filters.lastmodified}', 'YYYY-MM-DD"T"HH24:MI:SS')
                `;
            }

            // =========================
            // 🔥 HEADER QUERY
            // =========================
            var headerSql = `
                SELECT
                    t.id,
                    t.tranid,
                    t.trandate,
                    t.status                AS status_code,
                    BUILTIN.DF(t.status)    AS status_name,
                    NULL                    AS from_location_id,
                    NULL                    AS from_location_name,
                    NULL                    AS to_location_id,
                    NULL                    AS to_location_name,
                    t.memo,
                    t.lastmodifieddate      AS last_modified
                FROM transaction t
                ${whereClause}
                ORDER BY t.${sortBy} ${sortOrder}
                OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY
            `;

            log.debug('HEADER SQL', headerSql);

            var headerResult = query.runSuiteQL({
                query: headerSql
            }).asMappedResults();

            if (!headerResult.length) {
                return {
                    status: 'success',
                    page: page,
                    page_size: pageSize,
                    total_records: 0,
                    total_pages: 0,
                    data: []
                };
            }

            // =========================
            // 🔥 AMBIL IDS
            // =========================
            var ids = headerResult.map(function (h) {
                return h.id;
            });

            var placeholders = ids.join(',');

            // =========================
            // 🔥 LINE QUERY
            // =========================
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

            log.debug('LINE SQL', lineSql);

            var lineResult = query.runSuiteQL({
                query: lineSql
            }).asMappedResults();

            // =========================
            // 🔥 MAP DATA
            // =========================
            var map = {};

            headerResult.forEach(function (h) {
                map[h.id] = {
                    id: h.id,
                    tranid: h.tranid,
                    tran_date: h.tran_date,
                    status_code: h.status_code,
                    status_name: h.status_name,
                    from_location_id: null,
                    from_location_name: null,
                    to_location_id: null,
                    to_location_name: null,
                    memo: h.memo,
                    last_modified: h.last_modified,
                    items: []
                };
            });

            var seenItems = {};

            lineResult.forEach(function (l) {
                if (map[l.to_id]) {
                    
                    // Deduce Header Locations from lines dynamically
                    if (!map[l.to_id].from_location_id) {
                        map[l.to_id].from_location_id = l.from_location_id;
                        map[l.to_id].from_location_name = l.from_location_name;
                    } else if (map[l.to_id].from_location_id != l.from_location_id && !map[l.to_id].to_location_id) {
                        map[l.to_id].to_location_id = l.from_location_id;
                        map[l.to_id].to_location_name = l.from_location_name;
                    }
                    
                    // Filter out Destination/Receiving Lines from the Items Array
                    if (map[l.to_id].from_location_id && map[l.to_id].from_location_id != l.from_location_id) {
                        return; // Skip receiving line
                    }

                    // Deduplicate identical items (due to NetSuite's shipping/commitment double lines)
                    var dedupeKey = l.to_id + '_' + l.item_id + '_' + l.quantity;
                    if (!seenItems[dedupeKey]) {
                        
                        // Override line_number to be sequential visually for the API payload
                        var currentLines = map[l.to_id].items.length;
                        
                        map[l.to_id].items.push({
                            line_number: currentLines + 1,
                            item_id: l.item_id,
                            item_name: l.item_name,
                            description: l.description,
                            quantity: l.quantity,
                            from_location_id: l.from_location_id,
                            from_location_name: l.from_location_name
                        });
                        
                        seenItems[dedupeKey] = true;
                    }
                }
            });

            var data = Object.keys(map).map(function (k) {
                return map[k];
            });

            return {
                status: 'success',
                page: page,
                page_size: pageSize,
                total_records: data.length,
                total_pages: 1,
                data: data
            };

        } catch (e) {

            log.error('ERROR', e);

            return {
                status: 'error',
                message: e.message
            };
        }
    }

    return {
        post: post
    };
});