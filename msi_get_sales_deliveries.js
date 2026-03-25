/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Sales Delivery (Item Fulfillment) via POST
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
 */
define(['N/query', 'N/log'], function (query, log) {

    function post(context) {
        try {

            // =========================
            // 🔥 DEFAULT PARAM
            // =========================
            var page      = context.page       || 1;
            var pageSize  = context.page_size  || 20;
            var sortBy    = context.sort_by    || 'trandate';
            var sortOrder = context.sort_order || 'DESC';
            var filters   = context.filters    || {};

            // =========================
            // 🔥 VALIDASI SORT
            // =========================
            var allowedSort = {
                'trandate'        : 't.trandate',
                'lastmodifieddate': 't.lastmodifieddate',
                'tranid'          : 't.tranid'
            };

            if (!allowedSort[sortBy]) {
                sortBy = 'trandate';
            }

            var sortDir = (sortOrder === 'ASC') ? 'ASC' : 'DESC';

            // =========================
            // 🔥 FILTER BUILDER
            // =========================
            var whereClauses = ["t.type = 'ItemShip'"];

            if (filters.lastmodified) {
                // Konversi ISO ke format: MM/DD/YYYY untuk perbandingan date di SuiteQL
                var nsDate = isoToNsDate(filters.lastmodified);
                log.debug('LASTMODIFIED FILTER', nsDate);
                whereClauses.push("t.lastmodifieddate >= TO_DATE('" + nsDate + "', 'MM/DD/YYYY')");
            }

            var whereStr = whereClauses.join(' AND ');

            // =========================
            // 🔥 COUNT QUERY
            // =========================
            var countSql = "SELECT COUNT(*) AS cnt FROM transaction t WHERE " + whereStr;
            log.debug('COUNT SQL', countSql);

            var countResult = query.runSuiteQL({ query: countSql, params: [] });
            var totalRecords = 0;
            countResult.asMappedResults().forEach(function (row) {
                totalRecords = row.cnt || 0;
            });

            var totalPages = Math.ceil(totalRecords / pageSize);

            if (totalRecords === 0) {
                return {
                    status       : 'success',
                    page         : page,
                    page_size    : pageSize,
                    total_records: 0,
                    total_pages  : 0,
                    data         : []
                };
            }

            if (page > totalPages) {
                return {
                    status       : 'error',
                    message      : 'page melebihi total_pages (' + totalPages + ')',
                    total_records: totalRecords,
                    total_pages  : totalPages
                };
            }

            // =========================
            // 🔥 DATA QUERY
            // =========================
            var offset = (page - 1) * pageSize;

            var dataSql = [
                "SELECT",
                "  t.id,",
                "  t.tranid,",
                "  t.entity,",
                "  BUILTIN.DF(t.entity)    AS entity_name,",
                "  t.trandate,",
                "  t.status,",
                "  BUILTIN.DF(t.status)    AS status_name,",
                "  t.shipaddress,",
                "  t.memo,",
                "  t.lastmodifieddate",
                "FROM transaction t",
                "WHERE " + whereStr,
                "ORDER BY " + allowedSort[sortBy] + " " + sortDir,
                "OFFSET " + offset + " ROWS FETCH NEXT " + pageSize + " ROWS ONLY"
            ].join('\n');

            log.debug('DATA SQL', dataSql);

            var dataResult = query.runSuiteQL({ query: dataSql, params: [] });
            var rows = dataResult.asMappedResults();

            var data = rows.map(function (row) {
                return {
                    id           : String(row.id),
                    tranid       : row.tranid,
                    customer_id  : String(row.entity),
                    customer_name: row.entity_name,
                    tran_date    : row.trandate,
                    status_code  : row.status,
                    status_name  : row.status_name,
                    ship_address : row.shipaddress,
                    memo         : row.memo,
                    last_modified: row.lastmodifieddate
                };
            });

            return {
                status       : 'success',
                page         : page,
                page_size    : pageSize,
                total_records: totalRecords,
                total_pages  : totalPages,
                data         : data
            };

        } catch (e) {
            log.error('ERROR', e);
            return {
                status : 'error',
                message: e.message || JSON.stringify(e)
            };
        }
    }

    // =========================
    // 🔥 HELPER: ISO -> MM/DD/YYYY untuk SuiteQL TO_DATE filter
    // Input : "2026-03-01T00:00:00"
    // Output: "03/01/2026"
    // =========================
    function isoToNsDate(isoStr) {
        if (!isoStr) return null;
        var datePart = isoStr.substring(0, 10);  // "2026-03-01"
        var dp       = datePart.split('-');
        var year     = dp[0];
        var month    = dp[1];
        var day      = dp[2];
        return month + '/' + day + '/' + year;   // "03/01/2026"
    }

    return { post: post };
});
