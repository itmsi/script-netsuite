/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Purchase Order (header + lines) dengan pagination & filters
 *
 * POST body:
 * {
 *   "page":       1,               // Halaman (default: 1)
 *   "page_size":  20,              // Jumlah data per halaman (default: 20)
 *   "sort_by":    "t.id",          // Field untuk sorting (default: "t.id")
 *   "sort_order": "DESC",          // ASC / DESC (default: "DESC")
 *   "filters": {
 *     "po_ids":    [5157, 5158],   // Filter by ID (opsional)
 *     "po_number": "PO-2026-001",  // Filter by nomor PO (opsional)
 *     "status":    "PendReceipt",  // Filter status PO (opsional)
 *                                  //   PendReceipt = Pending Receipt
 *                                  //   PendBilling = Pending Billing
 *                                  //   FullyBilled = Fully Billed
 *                                  //   Closed      = Closed
 *     "date_from": "2026-01-01",   // Filter tanggal mulai (opsional, YYYY-MM-DD)
 *     "date_to":   "2026-03-31",   // Filter tanggal akhir (opsional, YYYY-MM-DD)
 *     "vendor_id": 10              // Filter by vendor ID (opsional)
 *   }
 * }
 */

define(['N/query'], (query) => {

    const post = (body) => {

        try {

            body = body || {};

            let page      = body.page      || 1;
            let pageSize  = body.page_size || 20;
            let offset    = (page - 1) * pageSize;
            let sortBy    = body.sort_by    || 't.id';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            let filters   = body.filters || {};

            // ── Bangun klausa WHERE dinamis ───────────────────────────────────
            let conditions = [`t.type = 'PurchOrd'`];
            let params     = [];

            if (filters.po_ids && Array.isArray(filters.po_ids) && filters.po_ids.length > 0) {
                let ids = filters.po_ids.map(id => parseInt(id)).filter(id => !isNaN(id));
                let placeholders = ids.map(() => '?').join(', ');
                conditions.push(`t.id IN (${placeholders})`);
                params.push(...ids);
            }

            if (filters.po_number) {
                conditions.push(`t.tranid = ?`);
                params.push(filters.po_number);
            }

            if (filters.status) {
                conditions.push(`t.status = ?`);
                params.push(filters.status);
            }

            if (filters.date_from) {
                conditions.push(`t.trandate >= TO_DATE(?, 'YYYY-MM-DD')`);
                params.push(filters.date_from);
            }

            if (filters.date_to) {
                conditions.push(`t.trandate <= TO_DATE(?, 'YYYY-MM-DD')`);
                params.push(filters.date_to);
            }

            if (filters.vendor_id) {
                conditions.push(`t.entity = ?`);
                params.push(parseInt(filters.vendor_id));
            }

            let whereClause = 'WHERE ' + conditions.join('\n                  AND ');

            // ── Query Header PO ───────────────────────────────────────────────
            let headerSql = `
                SELECT
                    t.id                                AS po_id,
                    t.tranid                            AS po_number,
                    TO_CHAR(t.trandate, 'YYYY-MM-DD')  AS po_date,
                    t.status                            AS po_status,
                    BUILTIN.DF(t.status)                AS po_status_label,
                    t.memo                              AS memo,
                    t.entity                            AS vendor_id,
                    BUILTIN.DF(t.entity)                AS vendor_name,
                    t.currency                          AS currency_id,
                    BUILTIN.DF(t.currency)              AS currency_symbol,
                    t.total                             AS total_amount
                FROM transaction t
                ${whereClause}
                ORDER BY ${sortBy} ${sortOrder}
            `;

            let allHeaders = query.runSuiteQL({ query: headerSql, params }).asMappedResults();

            let totalRecords = allHeaders.length;
            let totalPages   = Math.ceil(totalRecords / pageSize);

            // Pagination di sisi aplikasi
            let pagedHeaders = allHeaders.slice(offset, offset + pageSize);

            if (pagedHeaders.length === 0) {
                return {
                    status:        'success',
                    page,
                    page_size:     pageSize,
                    total_records: totalRecords,
                    total_pages:   totalPages,
                    data:          []
                };
            }

            // ── Query Lines PO (hanya untuk PO di halaman ini) ────────────────
            let foundPoIds       = pagedHeaders.map(h => h.po_id);
            let linePlaceholders = foundPoIds.map(() => '?').join(', ');

            let lineSql = `
                SELECT
                    tl.transaction                          AS po_id,
                    tl.linesequencenumber                   AS line_number,
                    tl.item                                 AS item_id,
                    BUILTIN.DF(tl.item)                     AS item_name,
                    tl.quantity                             AS quantity,
                    tl.rate                                 AS unit_price,
                    tl.memo                                 AS line_memo,
                    tl.location                             AS location_id,
                    BUILTIN.DF(tl.location)                 AS location_name,
                    tl.department                           AS department_id,
                    BUILTIN.DF(tl.department)               AS department_name,
                    tl.subsidiary                           AS subsidiary_id,
                    BUILTIN.DF(tl.subsidiary)               AS subsidiary_name
                FROM transactionline tl
                WHERE tl.transaction IN (${linePlaceholders})
                  AND tl.mainline    = 'F'
                  AND tl.itemtype   IS NOT NULL
                ORDER BY tl.transaction, tl.linesequencenumber
            `;

            let lineResults = query.runSuiteQL({ query: lineSql, params: foundPoIds }).asMappedResults();

            // ── Gabungkan header + lines ───────────────────────────────────────
            let linesByPo = {};
            lineResults.forEach(line => {
                let key = String(line.po_id);
                if (!linesByPo[key]) linesByPo[key] = [];
                linesByPo[key].push(line);
            });

            let data = pagedHeaders.map(header => ({
                ...header,
                lines: linesByPo[String(header.po_id)] || []
            }));

            return {
                status:        'success',
                page,
                page_size:     pageSize,
                total_records: totalRecords,
                total_pages:   totalPages,
                data
            };

        } catch (error) {
            return {
                status:  'error',
                name:    error.name,
                message: error.message,
                stack:   error.stack
            };
        }
    };

    return { post };

});
