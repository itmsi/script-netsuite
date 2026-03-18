/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/search', 'N/query'], (search, query) => {

    // Konversi tanggal NetSuite ("2/1/2029" atau "10/2/2026 2:22 PM") ke ISO 8601
    const formatToISO = (dateStr) => {
        if (!dateStr) return null;

        // Match: D/M/YYYY or M/D/YYYY with optional time "h:mm AM/PM"
        const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i;
        const m = dateStr.match(regex);
        if (!m) return dateStr;

        const day   = parseInt(m[1]);
        const month = parseInt(m[2]) - 1;
        const year  = parseInt(m[3]);
        let hour    = m[4] ? parseInt(m[4]) : 0;
        const min   = m[5] ? parseInt(m[5]) : 0;
        const ampm  = m[6] ? m[6].toUpperCase() : null;

        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        const pad = n => String(n).padStart(2, '0');
        return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(min)}:00+07:00`;
    };

    /**
     * POST handler - Get list of Sales Orders
     *
     * Request Body:
     {
       "page"       : 1,
       "page_size"  : 20,
       "sort_by"    : "trandate",
       "sort_order" : "DESC",
       "filters": {
         "tranid"      : "SO-0001",
         "id"          : ["100", "101"],
         "status"      : "pendingFulfillment",
         "customer_id" : "200",
         "lastmodified": "2025-11-17T23:59:00+07:00"
       }
     }
     *
     * Available sort_by:
     *   trandate, tranid, entity, status, id
     *
     * Status codes (nilai aktual dari N/search):
        pendingApproval             : 'SalesOrd:A',
        pendingFulfillment          : 'SalesOrd:B'
     */
    const post = (body) => {

        try {

            const page      = body.page      || 1;
            const pageSize  = Math.min(body.page_size || 20, 1000);
            const sortBy    = body.sort_by    || 'trandate';
            const sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const filters   = body.filters   || {};

            // ── Build filters ─────────────────────────────────────────────────
            const searchFilters = [['mainline', 'is', 'T']];

            // Filter: tranid (contains)
            if (filters.tranid) {
                searchFilters.push('AND', ['tranid', 'contains', filters.tranid.trim()]);
            }

            // Filter: id (single or array)
            if (filters.id) {
                const ids = Array.isArray(filters.id) ? filters.id : [filters.id];
                searchFilters.push('AND', ['internalid', 'anyof', ids]);
            }

            // Filter: status — terima format "pendingFulfillment" ATAU "SalesOrd:B"
            if (filters.status) {
                const statusMap = {
                    pendingApproval             : 'SalesOrd:A',
                    pendingFulfillment          : 'SalesOrd:B',
                    cancelled                   : 'SalesOrd:C',
                    partiallyFulfilled          : 'SalesOrd:D',
                    pendingBillingPartFulfilled  : 'SalesOrd:E',
                    pendingBilling              : 'SalesOrd:F',
                    fullyBilled                 : 'SalesOrd:G',
                    closed                      : 'SalesOrd:H'
                };
                const raw      = Array.isArray(filters.status) ? filters.status : [filters.status];
                const statuses = raw.map(s => statusMap[s] || s); // fallback: pakai as-is
                searchFilters.push('AND', ['status', 'anyof', statuses]);
            }

            // Filter: customer_id
            if (filters.customer_id) {
                const ids = Array.isArray(filters.customer_id)
                    ? filters.customer_id
                    : [filters.customer_id];
                searchFilters.push('AND', ['entity', 'anyof', ids]);
            }

            // Filter: lastmodified — return data modified on or after this date
            if (filters.lastmodified) {
                const d      = new Date(filters.lastmodified);
                const nsDate = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            // ── Sort column mapping ───────────────────────────────────────────
            const sortColMap = {
                'trandate' : 'trandate',
                'tranid'   : 'tranid',
                'entity'   : 'entity',
                'status'   : 'status',
                'id'       : 'internalid'
            };
            const sortColName = sortColMap[sortBy.replace('so.', '')] || 'trandate';
            const sortDir     = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            // ── Build columns (attach sort to the right column) ───────────────
            const columnDefs = [
                'tranid', 'entity', 'status', 'trandate',
                'memo', 'lastmodifieddate'
            ];

            const columns = columnDefs.map(name => {
                const colDef = { name };
                if (name === sortColName) colDef.sort = sortDir;
                return search.createColumn(colDef);
            });

            // internalid sort (not in columnDefs) — prepend if needed
            if (sortColName === 'internalid') {
                columns.unshift(search.createColumn({ name: 'internalid', sort: sortDir }));
            }

            // ── Run search ────────────────────────────────────────────────────
            const soSearch = search.create({
                type    : search.Type.SALES_ORDER,
                filters : searchFilters,
                columns : columns
            });

            const pagedData    = soSearch.runPaged({ pageSize });
            const pageIndex    = page - 1;
            const totalRecords = pagedData.count;
            const totalPages   = pagedData.pageRanges.length;

            // If page is out of range
            if (totalRecords === 0 || pageIndex >= pagedData.pageRanges.length) {
                return {
                    status        : 'success',
                    page          : page,
                    page_size     : pageSize,
                    total_records : totalRecords,
                    total_pages   : totalPages,
                    data          : []
                };
            }

            const pageResult = pagedData.fetch({ index: pageIndex });

            // ── Build header data ─────────────────────────────────────────────
            const headers = pageResult.data.map(r => ({
                id            : String(r.id),
                tranid        : r.getValue('tranid')                       || null,
                tran_date     : formatToISO(r.getValue('trandate'))        || null,
                status_code   : r.getValue('status')                       || null,
                status_name   : r.getText('status')                        || null,
                customer_id   : r.getValue('entity') ? String(r.getValue('entity')) : null,
                customer_name : r.getText('entity')                        || null,
                memo          : r.getValue('memo')                         || null,
                last_modified : formatToISO(r.getValue('lastmodifieddate')) || null
            }));

            // ── Fetch line items via SuiteQL (tl.description tersedia di SuiteQL) ──
            const soIds        = headers.map(h => h.id);
            const placeholders = soIds.map(() => '?').join(', ');

            const lineSql = `
                SELECT
                    tl.transaction                      AS so_id,
                    tl.linesequencenumber               AS line_number,
                    tl.item                             AS item_id,
                    BUILTIN.DF(tl.item)                 AS item_name,
                    tl.memo                             AS description,
                    ABS(tl.quantity)                    AS quantity,

                    -- 🔥 SHIPPED (dari Item Fulfillment)
                    NVL(SUM(ABS(itl.quantity)), 0)      AS shipped,

                    tl.rate                             AS rate,
                    ABS(tl.netamount)                   AS amount,
                    tl.location                         AS location_id,
                    BUILTIN.DF(tl.location)             AS location_name

                FROM transactionline tl

                LEFT JOIN NextTransactionLineLink ntl
                    ON ntl.previousdoc = tl.transaction
                    AND ntl.previousline = tl.id

                LEFT JOIN transactionline itl
                    ON itl.transaction = ntl.nextdoc
                    AND itl.id = ntl.nextline

                WHERE tl.transaction IN (${placeholders})
                AND tl.mainline    = 'F'
                AND tl.taxline     = 'F'
                AND tl.itemtype   IS NOT NULL

                GROUP BY
                    tl.transaction,
                    tl.linesequencenumber,
                    tl.item,
                    BUILTIN.DF(tl.item),
                    tl.memo,
                    tl.quantity,
                    tl.rate,
                    tl.netamount,
                    tl.location,
                    BUILTIN.DF(tl.location)

                ORDER BY tl.transaction, tl.linesequencenumber
            `;

            const lineResults = query.runSuiteQL({ query: lineSql, params: soIds.map(Number) }).asMappedResults();

            const linesByOrder = {};
            lineResults.forEach(line => {
                const soId = String(line.so_id);
                if (!linesByOrder[soId]) linesByOrder[soId] = [];
                linesByOrder[soId].push({
                    line_number   : line.line_number   != null ? Number(line.line_number) : null,
                    item_id       : line.item_id       != null ? String(line.item_id)     : null,
                    item_name     : line.item_name                                        || null,
                    description   : line.description                                      || null,
                    quantity      : line.quantity      != null ? Number(line.quantity)     : null,
                    shipped       : line.shipped       != null ? Number(line.shipped)      : 0,
                    rate          : line.rate          != null ? Number(line.rate)         : null,
                    amount        : line.amount        != null ? Number(line.amount)       : null,
                    location_id   : line.location_id   != null ? String(line.location_id) : null,
                    location_name : line.location_name                                    || null
                });
            });

            // ── Merge header + lines ──────────────────────────────────────────
            const data = headers.map(h => ({
                ...h,
                items: linesByOrder[h.id] || []
            }));

            return {
                status        : 'success',
                page          : page,
                page_size     : pageSize,
                total_records : totalRecords,
                total_pages   : totalPages,
                data          : data
            };

        } catch (e) {
            return {
                status  : 'error',
                message : e.message
            };
        }
    };

    return { post };
});
