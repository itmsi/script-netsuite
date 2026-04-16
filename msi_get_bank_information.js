/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Bank Information dari custom record: customrecord_me_csrec_bank_information
 * Mendukung pagination, sorting, dan filtering.
 *
 * POST body:
 {
   "page":       1,              // Halaman (default: 1)
   "page_size":  20,             // Jumlah data per halaman (default: 20)
   "sort_by":    "name",         // Field untuk sorting: "name" | "internalid" (default: "name")
   "sort_order": "ASC",          // ASC / DESC (default: "ASC")
   "filters": {
     "ids":         [1, 2, 3],  // Filter by internal ID (opsional)
     "name":        "BCA",      // Filter by nama bank, menggunakan contains (opsional)
     "is_inactive": false       // true = tampilkan yg inactive, false/null = hanya active (default: false)
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
                'name'      : 'name',
                'internalid': 'internalid'
            };
            var sCol = sortColMap[sortBy] || 'name';
            var sDir = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            // ── Bangun filter search ──────────────────────────────────────────
            var searchFilters = [];

            // Default: hanya tampilkan yang active (isinactive = false)
            if (!filters.is_inactive) {
                searchFilters.push(['isinactive', 'is', 'F']);
            }

            if (filters.ids && Array.isArray(filters.ids) && filters.ids.length > 0) {
                if (searchFilters.length > 0) searchFilters.push('AND');
                searchFilters.push(['internalid', 'anyof', filters.ids]);
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
            var bankSearch = search.create({
                type: 'customrecord_me_csrec_bank_information',
                filters: searchFilters,
                columns: columns
            });

            var pagedData    = bankSearch.runPaged({ pageSize: pageSize });
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
