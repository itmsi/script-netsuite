/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/search'], (search) => {

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
     * =============================================
     * STATUS CODES
     * status_code | status_name
     * ------------|-----------------------------
      A           | Pending Approval
      B           | Pending Fulfillment
      C           | Cancelled
      D           | Partially Fulfilled
      E           | Pending Billing/Part Fulfilled
      F           | Pending Billing
      G           | Fully Billed
      H           | Closed
     * =============================================
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

            // Filter: status — terima format "pendingFulfillment", "SalesOrd:B", atau huruf "B"
            if (filters.status) {
                const statusMap = {
                    // camelCase
                    pendingApproval            : 'SalesOrd:A',
                    pendingFulfillment         : 'SalesOrd:B',
                    cancelled                  : 'SalesOrd:C',
                    partiallyFulfilled         : 'SalesOrd:D',
                    pendingBillingPartFulfilled : 'SalesOrd:E',
                    pendingBilling             : 'SalesOrd:F',
                    fullyBilled                : 'SalesOrd:G',
                    closed                     : 'SalesOrd:H',
                    // huruf (status_code dari response)
                    A : 'SalesOrd:A',
                    B : 'SalesOrd:B',
                    C : 'SalesOrd:C',
                    D : 'SalesOrd:D',
                    E : 'SalesOrd:E',
                    F : 'SalesOrd:F',
                    G : 'SalesOrd:G',
                    H : 'SalesOrd:H'
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
                'memo', 'lastmodifieddate', 'datecreated',
                'otherrefnum', 'department', 'class', 'location', 
                'subsidiarynohierarchy', 'currency',
                'amount',
                'custbody_msi_quotation_no_iec', 
                'custbody_msi_bank_payment_so', 
                'custbody_cseg_cn_cfi',
                'intercotransaction',
                'custbody_me_approval_status',
                'intercostatus',
                'startdate',
                'enddate',
                'terms'
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

            const reverseStatusMap = {
                pendingApproval            : 'A',
                pendingFulfillment         : 'B',
                cancelled                  : 'C',
                partiallyFulfilled         : 'D',
                pendingBillingPartFulfilled : 'E',
                pendingBilling             : 'F',
                fullyBilled                : 'G',
                closed                     : 'H'
            };
            // ── Build header data ─────────────────────────────────────────────
            const headers = pageResult.data.map(r => ({
                id            : String(r.id),
                tranid        : r.getValue('tranid'),
                tran_date     : formatToISO(r.getValue('trandate')),
                status_code   : reverseStatusMap[r.getValue('status')],
                status_name   : r.getText('status'),
                customer_id   : r.getValue('entity') ? String(r.getValue('entity')) : null,
                customer_name : r.getText('entity'),
                memo          : r.getValue('memo'),
                start_date    : formatToISO(r.getValue('startdate')),
                end_date      : formatToISO(r.getValue('enddate')),
                terms         : r.getValue('terms'),
                terms_name    : r.getText('terms'),
                otherrefnum   : r.getValue('otherrefnum'),
                department    : r.getValue('department'),
                department_name: r.getText('department'),
                class_id      : r.getValue('class'), // using class_id to avoid js reserved word issues in some contexts
                class_name    : r.getText('class'),
                location      : r.getValue('location'),
                location_name : r.getText('location'),
                subsidiary    : r.getValue('subsidiarynohierarchy'),
                subsidiary_name: r.getText('subsidiarynohierarchy'),
                currency      : r.getValue('currency'),
                currency_name : r.getText('currency'),
                custbody_msi_quotation_no_iec: r.getValue('custbody_msi_quotation_no_iec'),
                custbody_msi_bank_payment_so : r.getValue('custbody_msi_bank_payment_so'),
                custbody_msi_bank_payment_so_name : r.getText('custbody_msi_bank_payment_so'),
                custbody_cseg_cn_cfi         : r.getValue('custbody_cseg_cn_cfi'),
                intercotransaction           : r.getValue('intercotransaction'),
                intercotransaction_name      : r.getText('intercotransaction'),
                intercostatus                : r.getValue('intercostatus'),
                custbody_me_approval_status  : r.getValue('custbody_me_approval_status'),
                custbody_me_approval_status_name : r.getText('custbody_me_approval_status'),
                intercostatus_name           : r.getText('intercostatus'),
                total_amount                 : r.getValue('amount') !== '' && r.getValue('amount') !== null ? r.getValue('amount') : 0,
                last_modified : formatToISO(r.getValue('lastmodifieddate')),
                datecreated   : formatToISO(r.getValue('datecreated'))      
            }));

            // ── Fetch line items via N/search ─────────────────────────────────
            const soIds = headers.map(h => h.id);
            const linesByOrder = {};

            if (soIds.length > 0) {
                const lineSearchFilters = [
                    ['internalid', 'anyof', soIds],
                    'AND',
                    ['mainline', 'is', 'F'],
                    'AND',
                    ['taxline', 'is', 'F'],
                    'AND',
                    ['shipping', 'is', 'F'],
                    'AND',
                    ['cogs', 'is', 'F']
                ];

                const lineSearchCols = [
                    search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'linesequencenumber', sort: search.Sort.ASC }),
                    'item',
                    'memo',
                    'quantity',
                    'quantityshiprecv',
                    'rate',
                    'amount',
                    'location',
                    'department',
                    'class',
                    'taxcode'
                ];

                const lineSearch = search.create({
                    type    : search.Type.SALES_ORDER,
                    filters : lineSearchFilters,
                    columns : lineSearchCols
                });

                // Fungsi helper offset fetch next (bypass 4000 limit)
                const fetchSearchResults = (searchObj, callback) => {
                    let start = 0;
                    const pageSize = 1000;
                    const resultSet = searchObj.run();
                    while (true) {
                        const results = resultSet.getRange({ start: start, end: start + pageSize });
                        if (!results || results.length === 0) break;
                        
                        let stopLoop = false;
                        for (let i = 0; i < results.length; i++) {
                            if (callback(results[i]) === false) {
                                stopLoop = true;
                                break;
                            }
                        }
                        if (stopLoop || results.length < pageSize) break;
                        start += pageSize;
                    }
                };

                fetchSearchResults(lineSearch, (result) => {
                    const soId = String(result.getValue('internalid'));
                    if (!linesByOrder[soId]) linesByOrder[soId] = [];
                    
                    const itemId = result.getValue('item');
                    if (!itemId) return true; // Skip empty lines if any

                    const rawQty = result.getValue('quantity');
                    const quantity = rawQty !== '' && rawQty !== null ? Math.abs(Number(rawQty)) : 0;
                    
                    const rawAmount = result.getValue('amount');
                    const amount = rawAmount !== '' && rawAmount !== null ? Math.abs(Number(rawAmount)) : 0;
                    
                    const rawShipped = result.getValue('quantityshiprecv');
                    const shipped = rawShipped !== '' && rawShipped !== null ? Number(rawShipped) : 0;

                    const rawRate = result.getValue('rate');
                    const rate = rawRate !== '' && rawRate !== null ? Number(rawRate) : null;

                    linesByOrder[soId].push({
                        line_number   : result.getValue('linesequencenumber') ? Number(result.getValue('linesequencenumber')) : null,
                        item_id       : String(itemId),
                        item_name     : result.getText('item'),
                        description   : result.getValue('memo'),
                        quantity      : quantity,
                        shipped       : shipped,
                        rate          : rate,
                        amount        : amount,
                        location      : result.getValue('location'),
                        location_id   : result.getValue('location') ? String(result.getValue('location')) : null,
                        location_name : result.getText('location'),
                        department    : result.getValue('department'),
                        department_name: result.getText('department'),
                        class         : result.getValue('class'), // property name 'class' is valid here
                        class_name    : result.getText('class'),
                        taxcode       : result.getValue('taxcode'),
                        taxcode_name  : result.getText('taxcode')
                    });
                    return true;
                });
            }

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
