/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Terms dengan pagination & filters menggunakan N/search
 *
 * POST body:
{
  "page":       1,              // Halaman (default: 1)
  "page_size":  20,             // Jumlah data per halaman (default: 20)
  "sort_by":    "name",         // Field untuk sorting: "name" | "internalid" (default: "name")
  "sort_order": "ASC",          // ASC / DESC (default: "ASC")
  "filters": {
    "term_ids":      [1, 2, 3], // Filter by internal ID (opsional)
    "name":          "Net 30",  // Filter by nama terms, menggunakan contains (opsional)
    "is_inactive":   false       // true = tampilkan yg inactive, false/null = hanya active (default: false)
  }
}
 */

define(['N/search'], function (search) {

    function post(context) {
        try {
            var page      = context.page      || 1;
            var pageSize  = Math.min(context.page_size || 20, 1000);
            var sortBy    = context.sort_by    || 'name';
            var sortOrder = (context.sort_order || 'ASC').toUpperCase();
            var filters   = context.filters   || {};

            // ── Mapping sort_by ke nama kolom search ──────────────────────────
            var sortColMap = {
                'name'            : 'name',
                'internalid'      : 'internalid'
            };
            var sCol = sortColMap[sortBy] || 'name';
            var sDir = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            // ── Bangun filter search ──────────────────────────────────────────
            var searchFilters = [];

            // Default: hanya tampilkan yang active (isinactive = false)
            if (!filters.is_inactive) {
                searchFilters.push(['isinactive', 'is', 'F']);
            }

            if (filters.term_ids && Array.isArray(filters.term_ids) && filters.term_ids.length > 0) {
                if (searchFilters.length > 0) searchFilters.push('AND');
                searchFilters.push(['internalid', 'anyof', filters.term_ids]);
            }

            if (filters.name) {
                if (searchFilters.length > 0) searchFilters.push('AND');
                searchFilters.push(['name', 'contains', filters.name.trim()]);
            }

            // ── Buat kolom search ─────────────────────────────────────────────
            var columns = [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'name' }),
                search.createColumn({ name: 'isinactive' })
            ];

            // Apply sort ke kolom yang sesuai
            for (var i = 0; i < columns.length; i++) {
                if (columns[i].name === sCol) {
                    columns[i].sort = sDir;
                    break;
                }
            }

            // ── Buat & jalankan search ────────────────────────────────────────
            var termSearch = search.create({
                type: 'term',
                filters: searchFilters,
                columns: columns
            });

            var pagedData    = termSearch.runPaged({ pageSize: pageSize });
            var totalRecords = pagedData.count;
            var totalPages   = pagedData.pageRanges.length;
            var pageIndex    = page - 1;

            if (totalRecords === 0 || pageIndex >= totalPages) {
                return {
                    status       : 'success',
                    page         : page,
                    page_size    : pageSize,
                    total_records: totalRecords,
                    total_pages  : totalPages,
                    data         : []
                };
            }

            var pageResult = pagedData.fetch({ index: pageIndex });

            var data = pageResult.data.map(function (r) {
                return {
                    id        : r.id,
                    name      : r.getValue('name') || null,
                    isinactive: r.getValue('isinactive') === 'T'
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
            return {
                status : 'error',
                name   : e.name,
                message: e.message,
                stack  : e.stack
            };
        }
    }

    return { post: post };

});
