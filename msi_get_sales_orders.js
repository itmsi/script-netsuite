/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/search', 'N/log'], (search, log) => {

    // Konversi tanggal NetSuite ("2/1/2029" atau "10/2/2026 2:22 PM") ke ISO 8601
    const formatToISO = (dateStr) => {
        if (!dateStr) return null;

        // Match: D/M/YYYY or M/D/YYYY with optional time "h:mm AM/PM"
        const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i;
        const m = dateStr.match(regex);
        if (!m) return dateStr;

        const day = parseInt(m[1]);
        const month = parseInt(m[2]) - 1;
        const year = parseInt(m[3]);
        let hour = m[4] ? parseInt(m[4]) : 0;
        const min = m[5] ? parseInt(m[5]) : 0;
        const ampm = m[6] ? m[6].toUpperCase() : null;

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

            const page = body.page || 1;
            const pageSize = Math.min(body.page_size || 20, 1000);
            const sortBy = body.sort_by || 'trandate';
            const sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const filters = body.filters || {};

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
                    pendingApproval: 'SalesOrd:A',
                    pendingFulfillment: 'SalesOrd:B',
                    cancelled: 'SalesOrd:C',
                    partiallyFulfilled: 'SalesOrd:D',
                    pendingBillingPartFulfilled: 'SalesOrd:E',
                    pendingBilling: 'SalesOrd:F',
                    fullyBilled: 'SalesOrd:G',
                    closed: 'SalesOrd:H',
                    // huruf (status_code dari response)
                    A: 'SalesOrd:A',
                    B: 'SalesOrd:B',
                    C: 'SalesOrd:C',
                    D: 'SalesOrd:D',
                    E: 'SalesOrd:E',
                    F: 'SalesOrd:F',
                    G: 'SalesOrd:G',
                    H: 'SalesOrd:H'
                };
                const raw = Array.isArray(filters.status) ? filters.status : [filters.status];
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
                const d = new Date(filters.lastmodified);
                const nsDate = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            // ── Sort column mapping ───────────────────────────────────────────
            const sortColMap = {
                'trandate': 'trandate',
                'tranid': 'tranid',
                'entity': 'entity',
                'status': 'status',
                'id': 'internalid'
            };
            const sortColName = sortColMap[sortBy.replace('so.', '')] || 'trandate';
            const sortDir = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

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
                'custbody_me_wf_next_approver_blank',
                'custbody_msi_createdby_api',
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

            // Workflow join column must be added separately (has a 'join' property)
            columns.push(search.createColumn({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }));

            // internalid sort (not in columnDefs) — prepend if needed
            if (sortColName === 'internalid') {
                columns.unshift(search.createColumn({ name: 'internalid', sort: sortDir }));
            }

            // ── Run search ────────────────────────────────────────────────────
            const soSearch = search.create({
                type: search.Type.SALES_ORDER,
                filters: searchFilters,
                columns: columns
            });

            const pagedData = soSearch.runPaged({ pageSize });
            const pageIndex = page - 1;
            const totalRecords = pagedData.count;
            const totalPages = pagedData.pageRanges.length;

            // If page is out of range
            if (totalRecords === 0 || pageIndex >= pagedData.pageRanges.length) {
                return {
                    status: 'success',
                    page: page,
                    page_size: pageSize,
                    total_records: totalRecords,
                    total_pages: totalPages,
                    data: []
                };
            }

            const pageResult = pagedData.fetch({ index: pageIndex });

            const reverseStatusMap = {
                pendingApproval: 'A',
                pendingFulfillment: 'B',
                cancelled: 'C',
                partiallyFulfilled: 'D',
                pendingBillingPartFulfilled: 'E',
                pendingBilling: 'F',
                fullyBilled: 'G',
                closed: 'H'
            };
            // ── Build header data ─────────────────────────────────────────────
            // Deduplicate by SO ID — join: 'workflow' can produce multiple rows
            // per SO if a transaction has more than one workflow instance.
            const seenIds = {};
            const headers = [];
            pageResult.data.forEach(r => {
                const id = String(r.id);
                if (seenIds[id]) return; // skip duplikat
                seenIds[id] = true;
                headers.push(({
                    id: String(r.id),
                    tranid: r.getValue('tranid'),
                    tran_date: formatToISO(r.getValue('trandate')),
                    status_code: reverseStatusMap[r.getValue('status')],
                    status_name: r.getText('status'),
                    customer_id: r.getValue('entity') ? String(r.getValue('entity')) : null,
                    customer_name: r.getText('entity'),
                    memo: r.getValue('memo'),
                    start_date: formatToISO(r.getValue('startdate')),
                    end_date: formatToISO(r.getValue('enddate')),
                    terms: r.getValue('terms'),
                    terms_name: r.getText('terms'),
                    otherrefnum: r.getValue('otherrefnum'),
                    department: r.getValue('department'),
                    department_name: r.getText('department'),
                    class_id: r.getValue('class'), // using class_id to avoid js reserved word issues in some contexts
                    class_name: r.getText('class'),
                    location: r.getValue('location'),
                    location_name: r.getText('location'),
                    subsidiary: r.getValue('subsidiarynohierarchy'),
                    subsidiary_name: r.getText('subsidiarynohierarchy'),
                    currency: r.getValue('currency'),
                    currency_name: r.getText('currency'),
                    custbody_msi_quotation_no_iec: r.getValue('custbody_msi_quotation_no_iec'),
                    custbody_msi_bank_payment_so: r.getValue('custbody_msi_bank_payment_so'),
                    custbody_msi_bank_payment_so_name: r.getText('custbody_msi_bank_payment_so'),
                    custbody_cseg_cn_cfi: r.getValue('custbody_cseg_cn_cfi'),
                    intercotransaction: r.getValue('intercotransaction'),
                    intercotransaction_name: r.getText('intercotransaction'),
                    intercostatus: r.getValue('intercostatus'),
                    custbody_me_approval_status: r.getValue('custbody_me_approval_status'),
                    custbody_me_approval_status_name: r.getText('custbody_me_approval_status'),
                    nextapprover: r.getText({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }) || r.getValue('custbody_me_wf_next_approver_blank'),
                    custbody_msi_createdby_api: r.getValue('custbody_msi_createdby_api'),
                    intercostatus_name: r.getText('intercostatus'),
                    total_amount: r.getValue('amount') !== '' && r.getValue('amount') !== null ? r.getValue('amount') : 0,
                    last_modified: formatToISO(r.getValue('lastmodifieddate')),
                    datecreated: formatToISO(r.getValue('datecreated'))
                }));
            });

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
                    search.createColumn({ name: 'displayname', join: 'item' }),
                    'item',
                    'memo',
                    'quantity',
                    'quantityshiprecv',
                    'quantitycommitted',
                    'quantitypicked',
                    'quantitypacked',
                    'quantitybilled',
                    'custcol_me_tier_price',
                    'unit',
                    'pricelevel',
                    'commitmentfirm',
                    'orderpriority',
                    'grossamount',
                    'taxamount',
                    'options',
                    'custcol_msi_booking_fee_so',
                    'custcol_msi_down_payment_percent',
                    'custcol_msi_down_payment_amount',
                    'excludefromraterequest',
                    'custcol_4601_witaxapplies',
                    'rate',
                    'amount',
                    'location',
                    'department',
                    'class',
                    'taxcode'
                ];

                const lineSearch = search.create({
                    type: search.Type.SALES_ORDER,
                    filters: lineSearchFilters,
                    columns: lineSearchCols
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

                    const rawCommitted = result.getValue('quantitycommitted');
                    const committed = rawCommitted !== '' && rawCommitted !== null ? Number(rawCommitted) : 0;
                    const backordered = Math.max(0, quantity - committed - shipped);

                    const grossamt = amount + Number(result.getValue('taxamount'));

                    linesByOrder[soId].push({
                        line_number: result.getValue('linesequencenumber') ? Number(result.getValue('linesequencenumber')) : null,
                        item_id: String(itemId),
                        item_name: result.getText('item'),
                        item_displayname: result.getValue({ name: 'displayname', join: 'item' }) || null,
                        description: result.getValue('memo'),
                        quantity: quantity,
                        shipped: shipped,
                        committed: result.getValue('quantitycommitted') || 0,
                        picked: result.getValue('quantitypicked') || 0,
                        packed: result.getValue('quantitypacked') || 0,
                        fulfilled: shipped, // using quantityshiprecv as fulfilled
                        invoiced: result.getValue('quantitybilled') || 0,
                        backordered: backordered,
                        available: null, // will be populated by inventory lookup
                        on_hand: null, // will be populated by inventory lookup
                        tier_price: result.getValue('custcol_me_tier_price') || null,
                        units: result.getValue('unit') || null,
                        price_level: result.getValue('pricelevel') || null,
                        price_level_name: result.getText('pricelevel') || null,
                        rate: rate,
                        amount: amount,
                        gross_amt_raw: result.getValue('grossamount'),
                        gross_amt: grossamt,
                        tax_amt: result.getValue('taxamount'),
                        tax_rate: 0, // will be populated by tax lookup
                        commitment_confirmed: result.getValue('commitmentfirm'),
                        order_priority: result.getValue('orderpriority'),
                        options: result.getValue('options'),
                        msi_booking_fee_unit: result.getValue('custcol_msi_booking_fee_so'),
                        msi_down_payment_percent: result.getValue('custcol_msi_down_payment_percent'),
                        msi_down_payment_amount: result.getValue('custcol_msi_down_payment_amount'),
                        exclude_item_from_rate_req: result.getValue('excludefromraterequest'),
                        apply_wh_tax: result.getValue('custcol_4601_witaxapplies'),
                        location_id: result.getValue('location') ? String(result.getValue('location')) : null,
                        location_name: result.getText('location'),
                        department: result.getValue('department'),
                        department_name: result.getText('department'),
                        class: result.getValue('class'), // property name 'class' is valid here
                        class_name: result.getText('class'),
                        taxcode: result.getValue('taxcode'),
                        taxcode_name: result.getText('taxcode')
                    });
                    return true;
                });

                // Robust tax rate lookup
                const taxCodeIds = [];
                Object.keys(linesByOrder).forEach((soId) => {
                    linesByOrder[soId].forEach((line) => {
                        if (line.taxcode && taxCodeIds.indexOf(line.taxcode) === -1) {
                            taxCodeIds.push(line.taxcode);
                        }
                    });
                });

                const taxRateMap = {};
                if (taxCodeIds.length > 0) {
                    const taxSearch = search.create({
                        type: 'salestaxitem',
                        filters: [['internalid', 'anyof', taxCodeIds]],
                        columns: ['rate']
                    });
                    taxSearch.run().each((r) => {
                        const rateStr = r.getValue('rate') || "0%";
                        taxRateMap[r.id] = parseFloat(rateStr.replace('%', '')) || 0;
                        return true;
                    });

                    // Fallback search for Tax Groups if needed
                    const missingIds = taxCodeIds.filter(id => !taxRateMap[id]);
                    if (missingIds.length > 0) {
                        const groupSearch = search.create({
                            type: 'taxgroup',
                            filters: [['internalid', 'anyof', missingIds]],
                            columns: ['rate']
                        });
                        groupSearch.run().each((r) => {
                            const rateStr = r.getValue('rate') || "0%";
                            taxRateMap[r.id] = parseFloat(rateStr.replace('%', '')) || 0;
                            return true;
                        });
                    }
                }

                // Populate tax rate back to lines
                Object.keys(linesByOrder).forEach((soId) => {
                    linesByOrder[soId].forEach((line) => {
                        if (line.taxcode && taxRateMap[line.taxcode] !== undefined) {
                            line.tax_rate = taxRateMap[line.taxcode];
                        }
                    });
                });

                // ── Location-specific inventory quantity lookup ────────────────
                // inventoryitem search is the only valid way to get qty per location
                const itemIds = [];
                const locationIds = [];
                Object.keys(linesByOrder).forEach((soId) => {
                    linesByOrder[soId].forEach((line) => {
                        if (line.item_id && itemIds.indexOf(line.item_id) === -1)
                            itemIds.push(line.item_id);
                        if (line.location && locationIds.indexOf(line.location) === -1)
                            locationIds.push(line.location);
                    });
                });

                if (itemIds.length > 0 && locationIds.length > 0) {
                    // key: "itemId_locationId" → { available, onhand }
                    const inventoryMap = {};
                    const invSearch = search.create({
                        type: search.Type.INVENTORY_ITEM,
                        filters: [
                            ['internalid', 'anyof', itemIds],
                            'AND',
                            ['inventorylocation', 'anyof', locationIds]
                        ],
                        columns: [
                            search.createColumn({ name: 'internalid' }),
                            search.createColumn({ name: 'locationquantityavailable' }),
                            search.createColumn({ name: 'locationquantityonhand' }),
                            search.createColumn({ name: 'inventorylocation' })
                        ]
                    });
                    invSearch.run().each((r) => {
                        const iId = String(r.id);
                        const loc = String(r.getValue('inventorylocation'));
                        const key = iId + '_' + loc;
                        inventoryMap[key] = {
                            available: r.getValue('locationquantityavailable') || null,
                            onhand: r.getValue('locationquantityonhand') || null
                        };
                        return true;
                    });

                    // Map quantities back to each line
                    Object.keys(linesByOrder).forEach((soId) => {
                        linesByOrder[soId].forEach((line) => {
                            const key = line.item_id + '_' + line.location;
                            const data = inventoryMap[key];
                            if (data) {
                                line.available = data.available;
                                line.on_hand = data.onhand;
                            }
                        });
                    });
                }
            }

            // ── Search User Notes ─────────────────────────────────────────────
            const notesByOrder = {};
            if (soIds.length > 0) {
                const noteSearch = search.create({
                    type: 'note',
                    filters: [
                        search.createFilter({
                            name: 'internalid',
                            join: 'transaction',
                            operator: search.Operator.ANYOF,
                            values: soIds
                        })
                    ],
                    columns: [
                        'internalid',
                        search.createColumn({ name: 'internalid', join: 'transaction' }),
                        'title', 'note', 'notedate', 'author', 'direction', 'notetype'
                    ]
                });

                const processedNoteIds = {};
                const fetchSearchResults2 = (searchObj, callback) => {
                    let start = 0;
                    const ps = 1000;
                    const resultSet = searchObj.run();
                    while (true) {
                        const results = resultSet.getRange({ start, end: start + ps });
                        if (!results || results.length === 0) break;
                        for (let i = 0; i < results.length; i++) {
                            if (callback(results[i]) === false) break;
                        }
                        if (results.length < ps) break;
                        start += ps;
                    }
                };

                fetchSearchResults2(noteSearch, res => {
                    const noteRecordId = res.id;
                    if (processedNoteIds[noteRecordId]) return true;
                    processedNoteIds[noteRecordId] = true;

                    const soId = res.getValue({ name: 'internalid', join: 'transaction' });
                    if (!notesByOrder[soId]) notesByOrder[soId] = [];

                    notesByOrder[soId].push({
                        title: res.getValue('title'),
                        note: res.getValue('note'),
                        date: res.getValue('notedate'),
                        author: res.getText('author'),
                        direction: res.getValue('direction'),
                        type: res.getText('notetype')
                    });
                    return true;
                });
            }

            // ── Search Attached Files via Custom Record ───────────────────────
            const filesByOrder = {};
            if (soIds.length > 0) {
                try {
                    // custrecord_msi_transaction_id is Free-Form Text, no ANYOF support
                    // Build OR conditions: [id1] OR [id2] OR ...
                    const idOrFilters = [];
                    soIds.forEach((id, i) => {
                        if (i > 0) idOrFilters.push('OR');
                        idOrFilters.push(['custrecord_msi_transaction_id', 'is', String(id)]);
                    });

                    const fileSearch = search.create({
                        type: 'customrecord_msi_web_url_file',
                        filters: [
                            idOrFilters,
                            'AND',
                            ['isinactive', 'is', 'F']
                        ],
                        columns: [
                            'name',
                            'custrecord_msi_transaction_id',
                            'custrecord_msi_web_url',
                            'custrecord_msi_createdby_api_file'
                        ]
                    });

                    const processedFileIds = {};
                    const fetchSearchResults3 = (searchObj, callback) => {
                        let start = 0;
                        const ps = 1000;
                        const resultSet = searchObj.run();
                        while (true) {
                            const results = resultSet.getRange({ start, end: start + ps });
                            if (!results || results.length === 0) break;
                            for (let i = 0; i < results.length; i++) {
                                if (callback(results[i]) === false) break;
                            }
                            if (results.length < ps) break;
                            start += ps;
                        }
                    };

                    fetchSearchResults3(fileSearch, res => {
                        const fileRecordId = res.id;
                        if (processedFileIds[fileRecordId]) return true;
                        processedFileIds[fileRecordId] = true;

                        const soId = res.getValue('custrecord_msi_transaction_id');
                        if (!soId) return true;
                        if (!filesByOrder[soId]) filesByOrder[soId] = [];
                        filesByOrder[soId].push({
                            id: res.id,
                            fileName: res.getValue('name'),
                            fileUrl: res.getValue('custrecord_msi_web_url'),
                            created_by_api: res.getValue('custrecord_msi_createdby_api_file')
                        });
                        return true;
                    });
                } catch (e) {
                    log.error('SO File Search Error', e.message);
                }
            }

            // ── Merge header + lines + notes + files ──────────────────────────
            const data = headers.map(h => ({
                ...h,
                items: linesByOrder[h.id] || [],
                user_notes: notesByOrder[h.id] || [],
                files: filesByOrder[String(h.id)] || []
            }));

            return {
                status: 'success',
                page: page,
                page_size: pageSize,
                total_records: totalRecords,
                total_pages: totalPages,
                data: data
            };

        } catch (e) {
            return {
                status: 'error',
                message: e.message
            };
        }
    };

    return { post };
});
