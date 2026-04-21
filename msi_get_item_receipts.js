/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Item Receipt (header + lines) dengan pagination & filters menggunakan N/search
 *
 * POST body:
 {
   "page":       1,               // Halaman (default: 1)
   "page_size":  20,              // Jumlah data per halaman (default: 20)
   "sort_by":    "internalid",    // Field untuk sorting (default: "internalid")
   "sort_order": "DESC",          // ASC / DESC (default: "DESC")
   "filters": {
     "receipt_ids": [100, 101],   // Filter by ID (opsional)
     "tranid": "IR-2026-001",     // Filter by nomor Item Receipt (opsional)
     "createdfrom_text": "PO-",   // Filter by nomor dokumen asal (opsional)
     "createdfrom": 5157,         // Filter by ID dokumen asal (opsional)
     "vendor_id": 10,             // Filter by vendor ID (opsional)
     "lastmodified": "2026-03-31T23:59:00+07:00" // Filter tanggal diubah (opsional)
   }
 }
 */

define(['N/search'], (search) => {
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

    const post = (body) => {
        try {
            body = body || {};

            let page      = body.page      || 1;
            let pageSize  = body.page_size || 20;
            let sortBy    = body.sort_by    || 'internalid';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? false : true; // DESC is default (true)

            // Mapping sort_by
            const sortMap = {
                'internalid': 'internalid',
                'id': 'internalid',
                'tranid': 'tranid',
                'trandate': 'trandate',
                'lastmodified': 'lastmodifieddate'
            };
            let searchSortCol = sortMap[sortBy] || 'internalid';

            let filtersBody = body.filters || {};

            // ── Bangun filter search ──────────────────────────────────────────
            let searchFilters = [
                ['mainline', 'is', 'T'],
                'AND',
                ['type', 'anyof', 'ItemRcpt']
            ];

            if (filtersBody.receipt_ids && Array.isArray(filtersBody.receipt_ids) && filtersBody.receipt_ids.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.receipt_ids]);
            }

            if (filtersBody.tranid) {
                searchFilters.push('AND', ['tranid', 'contains', filtersBody.tranid.trim()]);
            }

            if (filtersBody.createdfrom) {
                searchFilters.push('AND', ['createdfrom', 'anyof', filtersBody.createdfrom]);
            }

            if (filtersBody.createdfrom_text) {
                searchFilters.push('AND', ['createdfrom.tranid', 'contains', filtersBody.createdfrom_text.trim()]);
            }

            if (filtersBody.vendor_id) {
                searchFilters.push('AND', ['entity', 'anyof', filtersBody.vendor_id]);
            }

            if (filtersBody.lastmodified) {
                var d = new Date(filtersBody.lastmodified);
                var nsDate = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            // ── Buat Search Header ─────────────────────────────────────────────
            let headerSearch = search.create({
                type: search.Type.ITEM_RECEIPT,
                filters: searchFilters,
                columns: [
                    search.createColumn({ name: searchSortCol, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }),
                    'internalid', 'tranid', 'trandate', 'status', 'memo', 'entity', 
                    'createdfrom', 'lastmodifieddate', 'datecreated',
                    'location', 'subsidiarynohierarchy', 'department', 'class'
                ]
            });

            // ── Eksekusi Search Berhalaman ────────────────────────────────────
            let pagedData = headerSearch.runPaged({ pageSize: pageSize });
            let totalRecords = pagedData.count;
            let totalPages   = pagedData.pageRanges.length;

            if (totalRecords === 0 || page > totalPages) {
                return {
                    status:        'success',
                    page,
                    page_size:     pageSize,
                    total_records: totalRecords,
                    total_pages:   totalPages,
                    data:          []
                };
            }

            let searchPage = pagedData.fetch({ index: page - 1 });
            let pagedHeaders = [];
            let foundReceiptIds = [];

            searchPage.data.forEach(res => {
                foundReceiptIds.push(res.id);
                pagedHeaders.push({
                    receipt_id:           res.id,
                    tranid:               res.getValue('tranid'),
                    trandate:             res.getValue('trandate'),
                    status:               res.getValue('status'),
                    status_display:       res.getText('status'),
                    memo:                 res.getValue('memo'),
                    vendor_id:            res.getValue('entity'),
                    vendor_name:          res.getText('entity'),
                    createdfrom:          res.getValue('createdfrom'),
                    createdfrom_display:  res.getText('createdfrom'),
                    subsidiary:           res.getValue('subsidiarynohierarchy'),
                    subsidiary_display:   res.getText('subsidiarynohierarchy'),
                    location:             res.getValue('location'),
                    location_display:     res.getText('location'),
                    department:           res.getValue('department'),
                    department_display:   res.getText('department'),
                    class:                res.getValue('class'),
                    class_display:        res.getText('class'),
                    last_modified:        formatToISO(res.getValue('lastmodifieddate')),
                    datecreated:          formatToISO(res.getValue('datecreated'))
                });
            });

            // ── Search Line Items ─────────────────────────────────────────────
            let linesByReceipt = {};
            if (foundReceiptIds.length > 0) {
                let lineSearch = search.create({
                    type: search.Type.ITEM_RECEIPT,
                    filters: [
                        ['internalid', 'anyof', foundReceiptIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F'],
                        'AND',
                        ['shipping', 'is', 'F'],
                        'AND',
                        ['item', 'noneof', '@NONE@']
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                        search.createColumn({ name: 'line', sort: search.Sort.ASC }),
                        'item', 'quantity', 'rate', 'amount', 'memo', 
                        'location', 'department', 'class', 
                        search.createColumn({ name: 'inventorynumber', join: 'inventoryDetail' })
                    ]
                });

                lineSearch.run().each(res => {
                    let receiptId = res.getValue('internalid');
                    if (!linesByReceipt[receiptId]) linesByReceipt[receiptId] = [];

                    linesByReceipt[receiptId].push({
                        line:               res.getValue('line'),
                        item:               res.getValue('item'),
                        item_display:       res.getText('item'),
                        quantity:           res.getValue('quantity'),
                        rate:               res.getValue('rate'),
                        amount:             res.getValue('amount'),
                        memo:               res.getValue('memo'),
                        location:           res.getValue('location'),
                        location_display:   res.getText('location'),
                        department:         res.getValue('department'),
                        department_display: res.getText('department'),
                        class:              res.getValue('class'),
                        class_display:      res.getText('class'),
                        inventorydetail:    res.getText({ name: 'inventorynumber', join: 'inventoryDetail' })
                    });
                    return true;
                });
            }

            // ── Gabungkan header + lines ──────────────────────────
            let data = pagedHeaders.map(header => {
                header.lines = linesByReceipt[header.receipt_id] || [];
                return header;
            });

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
