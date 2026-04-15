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
                ['type', 'anyof', 'VendAuth'],
                'AND',
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
                type   : search.Type.TRANSACTION,
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

            // ── Map hasil ─────────────────────────────────────────────────────
            var data = pageResult.data.map(function (r) {
                return {
                    id           : String(r.id),
                    tranid       : r.getValue('tranid'),
                    vendor_id    : r.getValue('entity')  || null,
                    vendor_name  : r.getText('entity')   || null,
                    tran_date    : r.getValue('trandate'),
                    status_code  : r.getValue('status'),
                    status_name  : r.getText('status'),
                    memo         : r.getValue('memo')    || null,
                    last_modified: formatToISO(r.getValue('lastmodifieddate')),
                    datecreated  : formatToISO(r.getValue('datecreated'))
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
                message: e.message || JSON.stringify(e)
            };
        }
    }

    return { post: post };
});
