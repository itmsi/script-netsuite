/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Purchase Order (header + lines) dengan pagination & filters
 *
 * POST body:
{
  "page":       1,               // Halaman (default: 1)
  "page_size":  20,              // Jumlah data per halaman (default: 20)
  "sort_by":    "t.id",          // Field untuk sorting (default: "t.id")
  "sort_order": "DESC",          // ASC / DESC (default: "DESC")
  "filters": {
    "po_ids":    [5157, 5158],   // Filter by ID (opsional)
    "po_number": "PO-2026-001",  // Filter by nomor PO (opsional)
    "status":"PurchOrd:F",           // Filter status PO (opsional) — gunakan kode huruf:
                                 //   PurchOrd:A = Pending Supervisor Approval
                                 //   PurchOrd:B = Pending Receipt
                                 //   PurchOrd:C = Partially Received
                                 //   PurchOrd:D = Pending Billing/Partially Received
                                 //   PurchOrd:E = Pending Bill (partial)
                                 //   PurchOrd:F = Pending Bill
                                 //   PurchOrd:G = Fully Billed
                                 //   PurchOrd:H = Closed
    "lastmodified": "2026-03-31T23:59:00+07:00", // Filter tanggal diubah (opsional)
    "vendor_id": 10              // Filter by vendor ID (opsional)
  }
 * }
 */

define(['N/query'], (query) => {

    // Format tanggal SuiteQL ("M/D/YYYY" atau "YYYY-MM-DD") ke ISO 8601
    const formatDate = (val) => {
        if (!val) return null;
        // Jika sudah YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val + 'T00:00:00+07:00';
        // Format M/D/YYYY
        const m = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (m) {
            const pad = n => String(n).padStart(2, '0');
            return `${m[3]}-${pad(m[2])}-${pad(m[1])}T00:00:00+07:00`;
        }
        return val;
    };

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
                // SuiteQL menyimpan status sebagai "PurchOrd:F" — tambahkan prefix jika belum ada
                const rawStatus = filters.status;
                const status = rawStatus.startsWith('PurchOrd:') ? rawStatus : `PurchOrd:${rawStatus}`;
                conditions.push(`t.status = ?`);
                params.push(status);
            }

            if (filters.lastmodified) {
                // Strip timezone +07:00 / T separator agar cocok dengan TO_DATE format
                const raw = filters.lastmodified.replace('T', ' ').replace(/\+\d{2}:\d{2}$/, '').trim();
                conditions.push(`t.lastmodifieddate >= TO_DATE(?, 'YYYY-MM-DD HH24:MI:SS')`);
                params.push(raw);
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
                    t.trandate                          AS po_date,
                    t.status                            AS po_status,
                    BUILTIN.DF(t.status)                AS po_status_label,
                    t.memo                              AS memo,
                    t.entity                            AS vendor_id,
                    BUILTIN.DF(t.entity)                AS vendor_name,
                    t.currency                          AS currency_id,
                    BUILTIN.DF(t.currency)              AS currency_symbol,
                    t.lastmodifieddate                  AS last_modified
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
                po_id          : String(header.po_id),
                po_number      : header.po_number,
                po_date        : formatDate(header.po_date),
                po_status      : header.po_status,
                po_status_label: header.po_status_label,
                memo           : header.memo || null,
                vendor_id      : header.vendor_id ? String(header.vendor_id) : null,
                vendor_name    : header.vendor_name || null,
                currency_id    : header.currency_id ? String(header.currency_id) : null,
                currency_symbol: header.currency_symbol || null,
                last_modified  : formatDate(header.last_modified) || null,
                lines          : linesByPo[String(header.po_id)] || []
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
