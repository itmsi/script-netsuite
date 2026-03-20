/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Vendor Return via POST
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "trandate",
   "sort_order" : "DESC",
   "filters": {
     "lastmodified": "2026-12-16T23:59:00"
   }
 }
 */
define(['N/search', 'N/log'], function (search, log) {

    function post(context) {
        try {

            // =========================
            // 🔥 DEFAULT PARAM
            // =========================
            var page = context.page || 1;
            var pageSize = context.page_size || 20;
            var sortBy = context.sort_by || 'trandate';
            var sortOrder = context.sort_order || 'DESC';
            var filters = context.filters || {};

            // =========================
            // 🔥 VALIDASI SORT
            // =========================
            var allowedSort = {
                'trandate': 'trandate',
                'lastmodifieddate': 'lastmodifieddate',
                'tranid': 'tranid'
            };

            if (!allowedSort[sortBy]) {
                sortBy = 'trandate';
            }

            var nsSort = (sortOrder === 'ASC') ? search.Sort.ASC : search.Sort.DESC;

            // =========================
            // 🔥 FILTER BUILDER
            // =========================
            var searchFilters = [
                ['mainline', search.Operator.IS, 'T']
            ];

            if (filters.lastmodified) {
                // N/search: pakai tanggal saja tanpa time, format DD/MM/YYYY (locale Indonesia)
                var nsDate = isoToDateOnly(filters.lastmodified);
                log.debug('NS DATE FILTER', nsDate);
                searchFilters.push('AND');
                searchFilters.push(['lastmodifieddate', search.Operator.ONORAFTER, nsDate]);
            }

            // =========================
            // 🔥 BUILD SEARCH
            // =========================
            var columns = [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'trandate' }),
                search.createColumn({ name: 'status' }),
                search.createColumn({ name: 'amount' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'lastmodifieddate' }),
                search.createColumn({
                    name: allowedSort[sortBy],
                    sort: nsSort
                })
            ];

            // Deduplicate columns (kalau sortBy sama dengan column yang sudah ada)
            var seen = {};
            columns = columns.filter(function (col) {
                if (seen[col.name]) return false;
                seen[col.name] = true;
                return true;
            });

            log.debug('SEARCH FILTERS', JSON.stringify(searchFilters));

            var vrSearch = search.create({
                type: 'vendorreturnauthorization',
                filters: searchFilters,
                columns: columns
            });

            var pagedData;
            try {
                pagedData = vrSearch.runPaged({ pageSize: pageSize });
            } catch (searchErr) {
                log.error('ERROR RUN PAGED', searchErr.message || JSON.stringify(searchErr));
                throw new Error('Search gagal: ' + (searchErr.message || 'Cek permission role untuk Vendor Return'));
            }

            var totalRecords = pagedData.count;
            var totalPages = pagedData.pageRanges.length;

            // page (1-based) -> pageIndex (0-based)
            var pageIndex = page - 1;

            if (totalRecords === 0) {
                return {
                    status: 'success',
                    page: page,
                    page_size: pageSize,
                    total_records: 0,
                    total_pages: 0,
                    data: []
                };
            }

            if (pageIndex >= totalPages) {
                return {
                    status: 'error',
                    message: 'page melebihi total_pages (' + totalPages + ')',
                    total_records: totalRecords,
                    total_pages: totalPages
                };
            }

            var pageData = pagedData.fetch({ index: pageIndex });

            var data = pageData.data.map(function (result) {
                return {
                    id: result.getValue('internalid'),
                    tranid: result.getValue('tranid'),
                    vendor_id: result.getValue('entity'),
                    vendor_name: result.getText('entity'),
                    tran_date: result.getValue('trandate'),
                    status_code: result.getValue('status'),
                    status_name: result.getText('status'),
                    amount: result.getValue('amount'),
                    memo: result.getValue('memo'),
                    last_modified: result.getValue('lastmodifieddate')
                };
            });

            return {
                status: 'success',
                page: page,
                page_size: pageSize,
                total_records: totalRecords,
                total_pages: totalPages,
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

    // =========================
    // 🔥 HELPER: ISO -> NetSuite date string
    // Input : "2026-12-16T23:59:00" atau "2026-12-16T23:59:00+07:00"
    // Output: "12/16/2026 11:59 PM"
    // =========================
    function isoToNetSuiteDate(isoStr) {
        if (!isoStr) return null;

        // Ambil bagian tanggal & waktu saja (abaikan timezone offset)
        var cleanStr = isoStr.replace('T', ' ').substring(0, 19); // "2026-12-16 23:59:00"
        var parts = cleanStr.split(' ');
        var dateParts = parts[0].split('-');   // ["2026","12","16"]
        var timeParts = (parts[1] || '00:00:00').split(':'); // ["23","59","00"]

        var year = parseInt(dateParts[0]);
        var month = parseInt(dateParts[1]);
        var day = parseInt(dateParts[2]);
        var hour = parseInt(timeParts[0]);
        var min = parseInt(timeParts[1]);

        var ampm = 'AM';
        if (hour >= 12) {
            ampm = 'PM';
            if (hour > 12) hour -= 12;
        } else if (hour === 0) {
            hour = 12;
        }

        return month + '/' + day + '/' + year + ' ' + hour + ':' + String(min).padStart(2, '0') + ' ' + ampm;
    }

    // =========================
    // 🔥 HELPER: ISO -> Date only (DD/MM/YYYY) untuk N/search filter
    // Input : "2026-12-16T23:59:00"
    // Output: "16/12/2026"
    // =========================
    function isoToDateOnly(isoStr) {
        if (!isoStr) return null;
        var datePart = isoStr.substring(0, 10); // "2026-12-16"
        var parts = datePart.split('-');
        var year  = parts[0];
        var month = parts[1];
        var day   = parts[2];
        return day + '/' + month + '/' + year;  // "16/12/2026"
    }

    return { post: post };
});
