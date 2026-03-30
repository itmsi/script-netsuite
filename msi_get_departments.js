/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Department via POST
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "name",
   "sort_order" : "ASC",
   "filters": {
     "name"        : "Finance",
     "id"          : ["1", "2", "3"],
     "parent_id"   : "7",
     "subsidiary_id": "1",
     "is_inactive" : false,
     "lastmodified": "2026-01-01T00:00:00"
   }
 }
 *
 * sort_by values: "name" | "id" | "lastmodifieddate"
 */
define(['N/query', 'N/log'], function (query, log) {

    // Allowed sort columns
    var ALLOWED_SORT = {
        'name'            : 'name',
        'id'              : 'id',
        'lastmodifieddate': 'lastmodifieddate'
    };

    // Konversi "T"/"F" string ke boolean
    function toBool(val) {
        return val === 'T' || val === true;
    }

    // Konversi ISO string "YYYY-MM-DDThh:mm:ss" → "MM/DD/YYYY" untuk TO_DATE SuiteQL
    function isoToNsDate(isoStr) {
        if (!isoStr) return null;
        var datePart = isoStr.substring(0, 10); // "2026-01-01"
        var dp   = datePart.split('-');
        return dp[1] + '/' + dp[2] + '/' + dp[0]; // "MM/DD/YYYY"
    }

    function post(body) {
        try {

            // =========================
            // 🔥 DEFAULT PARAM
            // =========================
            var page      = body.page       || 1;
            var pageSize  = body.page_size  || 20;
            var offset    = (page - 1) * pageSize;
            var sortBy    = body.sort_by    || 'name';
            var sortOrder = (body.sort_order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

            if (!ALLOWED_SORT[sortBy]) {
                sortBy = 'name';
            }
            var sortCol = ALLOWED_SORT[sortBy];

            var filters    = body.filters || {};
            var conditions = [];
            var params     = [];

            // =========================
            // 🔥 FILTER BUILDER
            // =========================

            // Filter: name (contains, case-insensitive)
            if (filters.name) {
                conditions.push("LOWER(name) LIKE LOWER(?)");
                params.push('%' + filters.name.trim() + '%');
            }

            // Filter: id (single atau array)
            if (filters.id) {
                if (Array.isArray(filters.id)) {
                    var placeholders = filters.id.map(function () { return '?'; }).join(', ');
                    conditions.push('id IN (' + placeholders + ')');
                    filters.id.forEach(function (v) { params.push(v); });
                } else {
                    conditions.push('id = ?');
                    params.push(filters.id);
                }
            }

            // Filter: parent_id (single atau array)
            if (filters.parent_id) {
                if (Array.isArray(filters.parent_id)) {
                    var ppPlaceholders = filters.parent_id.map(function () { return '?'; }).join(', ');
                    conditions.push('parent IN (' + ppPlaceholders + ')');
                    filters.parent_id.forEach(function (v) { params.push(v); });
                } else {
                    conditions.push('parent = ?');
                    params.push(filters.parent_id);
                }
            }

            // Filter: subsidiary_id
            if (filters.subsidiary_id) {
                conditions.push('subsidiary = ?');
                params.push(filters.subsidiary_id);
            }

            // Filter: is_inactive (true / false)
            if (filters.is_inactive !== undefined && filters.is_inactive !== null) {
                conditions.push('isinactive = ?');
                params.push(filters.is_inactive ? 'T' : 'F');
            }

            // Filter: lastmodified (on or after)
            if (filters.lastmodified) {
                var nsDate = isoToNsDate(filters.lastmodified);
                conditions.push("lastmodifieddate >= TO_DATE(?, 'MM/DD/YYYY')");
                params.push(nsDate);
                log.debug('LASTMODIFIED FILTER', nsDate);
            }

            var whereClause = conditions.length > 0
                ? 'WHERE ' + conditions.join(' AND ')
                : '';

            // =========================
            // 🔥 DATA QUERY
            // =========================
            var dataSql = [
                'SELECT',
                '  id,',
                '  name,',
                '  isinactive,',
                '  parent,',
                '  BUILTIN.DF(parent)      AS parent_name,',
                '  subsidiary,',
                '  BUILTIN.DF(subsidiary)  AS subsidiary_name,',
                '  lastmodifieddate',
                'FROM Department',
                whereClause,
                'ORDER BY ' + sortCol + ' ' + sortOrder
            ].join('\n');

            log.debug('DATA SQL', dataSql);
            log.debug('PARAMS', JSON.stringify(params));

            var rows = query.runSuiteQL({ query: dataSql, params: params }).asMappedResults();

            var allData = rows.map(function (r) {
                return {
                    id             : String(r.id),
                    name           : r.name,
                    is_inactive    : toBool(r.isinactive),
                    parent_id      : r.parent      ? String(r.parent)      : null,
                    parent_name    : r.parent_name || null,
                    subsidiary_id  : r.subsidiary  ? String(r.subsidiary)  : null,
                    subsidiary_name: r.subsidiary_name || null,
                    last_modified  : r.lastmodifieddate
                };
            });

            // =========================
            // 🔥 PAGINATION (JavaScript)
            // =========================
            var totalRecords = allData.length;
            var totalPages   = Math.ceil(totalRecords / pageSize) || 0;

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

            var paginated = allData.slice(offset, offset + pageSize);

            return {
                status       : 'success',
                page         : page,
                page_size    : pageSize,
                total_records: totalRecords,
                total_pages  : totalPages,
                data         : paginated
            };

        } catch (e) {
            log.error('ERROR', e);
            return {
                status : 'error',
                message: e.message || JSON.stringify(e)
            };
        }
    }

    return { post: post };
});
