/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Customer Return (Return Authorization) via POST
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

        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;

        return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00+07:00`;
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

        return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T00:00:00+07:00`;
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
            // Customer Return Authorization type = 'RtnAuth'
            // =========================
            var whereClauses = ["t.type = 'RtnAuth'"];

            if (filters.lastmodified) {
                var nsDate = isoToNsDate(filters.lastmodified);
                whereClauses.push("t.lastmodifieddate >= TO_DATE('" + nsDate + "', 'MM/DD/YYYY')");
            }

            var whereStr = whereClauses.join(' AND ');

            // =========================
            // 🔥 COUNT QUERY
            // =========================
            var countSql = "SELECT COUNT(*) AS cnt FROM transaction t WHERE " + whereStr;

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
                "  BUILTIN.DF(t.entity)  AS entity_name,",
                "  t.trandate,",
                "  t.status,",
                "  BUILTIN.DF(t.status) AS status_name,",
                "  t.memo,",
                "  t.lastmodifieddate",
                "FROM transaction t",
                "WHERE " + whereStr,
                "ORDER BY " + allowedSort[sortBy] + " " + sortDir,
                "OFFSET " + offset + " ROWS FETCH NEXT " + pageSize + " ROWS ONLY"
            ].join('\n');

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
                    memo         : row.memo,
                    last_modified: formatToISO(row.lastmodifieddate)
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
