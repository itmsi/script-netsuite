/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Purchase Order (header + lines) dengan pagination & filters menggunakan N/search
 *
 * POST body:
{
  "page":       1,               // Halaman (default: 1)
  "page_size":  20,              // Jumlah data per halaman (default: 20)
  "sort_by":    "internalid",    // Field untuk sorting (default: "internalid")
  "sort_order": "DESC",          // ASC / DESC (default: "DESC")
  "filters": {
    "po_ids":    [5157, 5158],   // Filter by ID (opsional)
    "po_number": "PO-2026-001",  // Filter by nomor PO (opsional)
    "status":"F",     
    "lastmodified": "2026-03-31T23:59:00+07:00", // Filter tanggal diubah (opsional)
    "vendor_id": 10              // Filter by vendor ID (opsional)
  }
}
 */

define(['N/search', 'N/query', 'N/log'], (search, query, log) => {
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

            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`;
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

            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+07:00`;
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

            let page = body.page || 1;
            let pageSize = body.page_size || 20;
            let sortBy = body.sort_by || 'lastmodifieddate';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? false : true; // DESC is default (true)



            let filtersBody = body.filters || {};

            // ── Bangun filter search ──────────────────────────────────────────
            let searchFilters = [
                ['mainline', 'is', 'T'],
                'AND',
                ['type', 'anyof', 'PurchOrd']
            ];

            if (filtersBody.po_ids && Array.isArray(filtersBody.po_ids) && filtersBody.po_ids.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.po_ids]);
            }

            if (filtersBody.po_number) {
                searchFilters.push('AND', ['numbertext', 'is', filtersBody.po_number]);
            }

            if (filtersBody.status) {
                const status = filtersBody.status.startsWith('PurchOrd:') ? filtersBody.status : `PurchOrd:${filtersBody.status}`;
                searchFilters.push('AND', ['status', 'anyof', status]);
            }

            if (filtersBody.lastmodified) {
                var d = new Date(filtersBody.lastmodified);
                var nsDate = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            if (filtersBody.vendor_id) {
                searchFilters.push('AND', ['vendor.internalid', 'anyof', filtersBody.vendor_id]);
            }

            let sortColumn = sortBy;
            let searchColumns = [
                'tranid', 'trandate', 'status', 'memo', 'entity', 'currency',
                // 'subtotal', 'taxtotal', 'total',
                'amount', 'fxamount', 'lastmodifieddate', 'approvalstatus',
                'location', 'subsidiary', 'custbody_me_wf_created_by',
                'custbody_me_wf_in_delegation', 'custbody_me_delegate_approver',
                'custbody_msi_createdby_api', 'custbody_me_pr_date',
                'custbody_me_project_location', 'custbody_me_pr_type',
                'custbody_me_saving_type', 'custbody_me_pr_number', 'intercotransaction', 'terms',
                'duedate', 'otherrefnum', 'customform', 'class',
                search.createColumn({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }),
                'subsidiarynohierarchy', 'custbody_me_validity_date', 'department', 'datecreated'
            ];

            if (sortColumn === 'lastmodifieddate') {
                searchColumns.unshift(search.createColumn({ name: 'lastmodifieddate', sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }));
            } else {
                searchColumns.unshift('lastmodifieddate');
                let foundIndex = -1;
                for (let i = 0; i < searchColumns.length; i++) {
                    if (typeof searchColumns[i] === 'string' && searchColumns[i] === sortColumn) {
                        foundIndex = i;
                        break;
                    }
                }
                if (foundIndex > -1) {
                    searchColumns[foundIndex] = search.createColumn({ name: sortColumn, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC });
                } else {
                    searchColumns.push(search.createColumn({ name: sortColumn, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }));
                }
            }

            // ── Buat Search Header ─────────────────────────────────────────────
            let headerSearch = search.create({
                type: search.Type.PURCHASE_ORDER,
                filters: searchFilters,
                columns: searchColumns
                 
            });

            // ── Eksekusi Search Berhalaman (Bypass Limit Minimal Page Size NetSuite < 5) ──
            let totalRecords = 0;
            let totalPages = 0;
            let searchResults = [];

            if (pageSize >= 5) {
              
                let pagedData = headerSearch.runPaged({ pageSize: pageSize });
                totalRecords = pagedData.count;
                totalPages = pagedData.pageRanges.length;
              
                if (totalRecords > 0 && page <= totalPages) {
                    let searchPage = pagedData.fetch({ index: page - 1 });
                    searchResults = searchPage.data;
                }
            } else {
                totalRecords = headerSearch.runPaged().count;
                totalPages = Math.ceil(totalRecords / pageSize);

                if (totalRecords > 0 && page <= totalPages) {
                    let startIndex = (page - 1) * pageSize;
                    let endIndex = startIndex + pageSize;
                    searchResults = headerSearch.run().getRange({ start: startIndex, end: endIndex }) || [];
                }
            }

            if (totalRecords === 0 || page > totalPages) {
                return {
                    status: 'success',
                    page,
                    page_size: pageSize,
                    total_records: totalRecords,
                    total_pages: totalPages,
                    data: []
                };
            }

            let pagedHeaders = [];
            let foundPoIds = [];
            let currencyByPo = {};

            searchResults.forEach(res => {
                foundPoIds.push(res.id);
                currencyByPo[res.id] = res.getText('currency');
                pagedHeaders.push({
                    po_id                       : res.id,
                    po_number                   : res.getValue('tranid'),
                    po_date                     : res.getValue('trandate'),
                    po_status                   : res.getValue('status'),
                    po_status_label             : res.getText('status'),
                    memo                        : res.getValue('memo'),
                    vendor_id                   : res.getValue('entity'),
                    vendor_name                 : res.getText('entity'),
                    currency_id                 : res.getValue('currency'),
                    currency_symbol             : res.getText('currency'),
                    // subtotal                    : res.getValue('subtotal'),
                    // taxtotal                    : res.getValue('taxtotal'),
                    // total                       : res.getValue('total'),
                    foreigntotal                : res.getValue('fxamount'),
                    total                       : res.getValue('amount'),
                    last_modified               : formatToISO(res.getValue('lastmodifieddate')),
                    approvalstatus              : res.getValue('approvalstatus'),
                    approvalstatus_display      : res.getText('approvalstatus'),
                    created_by                  : res.getText('custbody_me_wf_created_by'),
                    custbody_me_wf_created_by   : res.getValue('custbody_me_wf_created_by'),
                    custbody_me_wf_in_delegation: res.getValue('custbody_me_wf_in_delegation'),
                    custbody_me_delegate_approver: res.getValue('custbody_me_delegate_approver'),
                    custbody_msi_createdby_api  : res.getValue('custbody_msi_createdby_api'),
                    custbody_me_pr_date         : res.getValue('custbody_me_pr_date'),
                    custbody_me_project_location: res.getValue('custbody_me_project_location'),
                    custbody_me_pr_type         : res.getValue('custbody_me_pr_type'),
                    custbody_me_saving_type     : res.getValue('custbody_me_saving_type'),
                    custbody_me_pr_number       : res.getValue('custbody_me_pr_number'),
                    intercotransaction          : res.getValue('intercotransaction'),
                    terms                       : res.getValue('terms'),
                    terms_display               : res.getText('terms'),
                    duedate                     : res.getValue('duedate'),
                    otherrefnum                 : res.getValue('otherrefnum'),
                    subsidiary                  : res.getValue('subsidiarynohierarchy'),
                    subsidiary_display          : res.getText('subsidiarynohierarchy'),
                    location                    : res.getValue('location'),
                    location_display            : res.getText('location'),
                    customform                  : res.getValue('customform'),
                    customform_display          : res.getText('customform'),
                    class                       : res.getValue('class'),
                    class_display               : res.getText('class'),
                    nextapprover: res.getText({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }),
                    custbody_me_validity_date   : res.getValue('custbody_me_validity_date'),
                    department                  : res.getValue('department'),
                    department_display          : res.getText('department'),
                    datecreated                 : formatToISO(res.getValue('datecreated'))
                });
            });

            //  fungsi helper offset fetch next (bypass 4000 limit)
            const fetchSearchResults = (searchObj, callback) => {
                let start = 0;
                let pageSize = 1000;
                let resultSet = searchObj.run();
                while (true) {
                    let results = resultSet.getRange({ start: start, end: start + pageSize });
                    if (!results || results.length === 0) break;
                    
                    for (let i = 0; i < results.length; i++) {
                        callback(results[i]);
                    }

                    if (results.length < pageSize) break;
                    start += pageSize;
                }
            };

            // ── Search Line Items ─────────────────────────────────────────────
            let linesByPo = {};
            if (foundPoIds.length > 0) {
                let lineSearch = search.create({
                    type: search.Type.PURCHASE_ORDER,
                    filters: [
                        ['internalid', 'anyof', foundPoIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F'],
                        'AND',
                        ['shipping', 'is', 'F']
                    ],
                    columns: [
                        'internalid', 'line', 'lineuniquekey', 'item', 'itemtype', 'quantity', 'quantityshiprecv', 'quantitybilled',
                        'rate', 'amount', 'fxamount', 'taxamount',
                        search.createColumn({
                            name: 'formulanumericrate',
                            formula: '{fxamount} / NULLIF({quantity}, 0)',
                            label: 'Rate Foreign'
                        }),
                        search.createColumn({
                            name: 'formulanumeric',
                            formula: '{taxamount} / NULLIF({exchangerate}, 0)',
                            label: 'Tax Amount Foreign'
                        }),
                        'grossamount', 'taxcode', 'memo',
                        'location', 'department', 'class',
                        'matchbilltoreceipt', 'expectedreceiptdate', 'custcol_4601_witaxapplies', 'custcol_msi_fob', 'custcol_me_landed_cost'
                    ]
                });

                fetchSearchResults(lineSearch, res => {
                    let poId = res.getValue('internalid');
                    if (!linesByPo[poId]) linesByPo[poId] = [];

                    const rawQty = res.getValue('quantity');
                    const quantity = rawQty !== '' && rawQty !== null ? Math.abs(parseFloat(rawQty)) : 0;
                    let fxAmt = res.getValue('fxamount');
                    let baseAmt = res.getValue('amount');
                    let lineAmount = fxAmt || baseAmt;  // gunakan fxamount jika ada, jika tidak gunakan amount

                    let rateValue = res.getValue('rate');
                    let taxValue = res.getValue('taxamount');
                    let poCurrency = currencyByPo[poId] || null;
                    if (poCurrency && poCurrency !== 'IDR') {
                        rateValue = res.getValue({ name: 'formulanumericrate' });
                        taxValue = res.getValue({ name: 'formulanumeric' });
                    }
                    const qtyReceived = res.getValue('quantityshiprecv') || 0;
                    let commitedQty = quantity - qtyReceived;
                    let backorder = Math.max(0, quantity - commitedQty - qtyReceived);

                    let lineRate = quantity > 0 ? Number(rateValue) : Number(lineAmount);
                    let lineTaxAmt = Number(taxValue) || 0;
                    let grossAmt = (Math.abs(lineAmount) + Math.abs(lineTaxAmt));

                    linesByPo[poId].push({
                        transaction: poId,
                        linesequencenumber: Number(res.getValue('line')),
                        line_id: res.getValue('lineuniquekey'),
                        item: res.getValue('item'),
                        item_display: res.getText('item'),
                        itemtype: res.getValue('itemtype'),
                        quantity: quantity,
                        quantitybilled: res.getValue('quantitybilled'),
                        quantityreceived: res.getValue('quantityshiprecv'),
                        committed: commitedQty,
                        backordered: backorder,
                        rate: lineRate,
                        netamount: lineAmount,
                        tax1amt: Math.abs(lineTaxAmt),
                        grossamt: grossAmt,
                        taxcode: res.getValue('taxcode'),
                        taxcode_display: res.getText('taxcode'),
                        taxrate1: res.getValue('taxrate'),
                        description: res.getValue('memo'),
                        location: res.getValue('location'),
                        location_display: res.getText('location'),
                        department: res.getValue('department'),
                        department_display: res.getText('department'),
                        class: res.getValue('class'),
                        class_display: res.getText('class'),
                        units: res.getText('units'),
                        units_display: res.getText('units'),
                        isbillable: res.getValue('isbillable'),
                        isclosed: res.getValue('isclosed'),
                        matchbilltoreceipt: res.getValue('matchbilltoreceipt'),
                        expectedreceiptdate: res.getValue('expectedreceiptdate'),
                        custcol_4601_witaxapplies: res.getValue('custcol_4601_witaxapplies'),
                        custcol_msi_fob: res.getValue('custcol_msi_fob'),
                        custcol_me_landed_cost: res.getValue('custcol_me_landed_cost')
                    });
                    return true;
                });
            }

            // ── Search User Notes ─────────────────────────────────────────────
            let notesByPo = {};
            if (foundPoIds.length > 0) {
                let noteSearch = search.create({
                    type: 'note',
                    filters: [
                        search.createFilter({
                            name: 'internalid',
                            join: 'transaction',
                            operator: search.Operator.ANYOF,
                            values: foundPoIds
                        })
                    ],
                    columns: [
                        'internalid',
                        search.createColumn({ name: 'internalid', join: 'transaction' }),
                        'title',
                        'note',
                        'notedate',
                        'author',
                        'direction',
                        'notetype'
                    ]
                });

                let processedNoteIds = {};
                fetchSearchResults(noteSearch, res => {
                    let noteRecordId = res.id;
                    if (processedNoteIds[noteRecordId]) return true;
                    processedNoteIds[noteRecordId] = true;

                    let poId = res.getValue({ name: 'internalid', join: 'transaction' });
                    if (!notesByPo[poId]) notesByPo[poId] = [];

                    notesByPo[poId].push({
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

            // ── Search Custom Attach Files via N/search ───────────────────────
            // Sama seperti notes: filter & column via search.createFilter/createColumn dengan join
            let filesByPo = {};
            if (foundPoIds.length > 0) {
                try {
                    // custrecord_msi_transaction_id = Free-Form Text, tidak support ANYOF
                    // Bangun OR conditions: [id1] OR [id2] OR [id3] ...
                    let idOrFilters = [];
                    foundPoIds.forEach((id, i) => {
                        if (i > 0) idOrFilters.push('OR');
                        idOrFilters.push(['custrecord_msi_transaction_id', 'is', String(id)]);
                    });

                    let fileSearch = search.create({
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

                    let processedFileIds = {};
                    fetchSearchResults(fileSearch, res => {
                        let fileRecordId = res.id;
                        if (processedFileIds[fileRecordId]) return true;
                        processedFileIds[fileRecordId] = true;

                        let poId = res.getValue('custrecord_msi_transaction_id');
                        if (!poId) return true;
                        if (!filesByPo[poId]) filesByPo[poId] = [];
                        filesByPo[poId].push({
                            id: res.id,
                            fileName: res.getValue('name'),
                            fileUrl: res.getValue('custrecord_msi_web_url'),
                            created_by_api: res.getValue('custrecord_msi_createdby_api_file')
                        });
                        return true;
                    });
                } catch (e) {
                    log.error('File Search Error', e.message);
                }
            }

            // ── Ambil Data Inbound Shipment via SuiteQL ──────────────────────
            let lineShipmentMap = {};
            if (foundPoIds.length > 0) {
                try {
                    let sql = `
                        SELECT 
                            isi.id as shipment_item_id,
                            isi.purchaseordertransaction as po_id, 
                            tl.uniquekey as line_uniquekey,
                            BUILTIN.DF(isi.inboundshipment) as shipment_number 
                        FROM 
                            InboundShipmentItem isi
                        JOIN 
                            TransactionLine tl ON isi.shipmentitemtransaction = tl.uniquekey
                        WHERE 
                            isi.purchaseordertransaction IN (${foundPoIds.join(',')})
                    `;
                    let queryResults = query.runSuiteQL({ query: sql }).asMappedResults();
                    queryResults.forEach(r => {
                        // Untuk per-Line
                        lineShipmentMap[r.line_uniquekey] = {
                            id: r.shipment_item_id,
                            number: r.shipment_number
                        };
                    });
                } catch (e) {
                    // Jika query gagal, biarkan kosong
                }
            }

            // ── Gabungkan header + lines + shipments ──────────────────────────
            let data = pagedHeaders.map(header => {
                let lines = linesByPo[header.po_id] || [];

                // Map shipment ke tiap line
                lines.map(line => {
                    let shipmentData = lineShipmentMap[line.line_id] || null; // line_id berisi lineuniquekey
                    line.inbound_shipment_number = shipmentData ? shipmentData.number : null;
                    line.inbound_shipment_line_id = shipmentData ? shipmentData.id : null;
                    line.has_inbound = !!shipmentData;
                    return line;
                });

                header.lines = lines;
                header.user_notes = notesByPo[header.po_id] || [];
                // filesByPo di-key dengan String(po_id) agar cocok dengan custrecord_msi_transaction_id
                header.files = filesByPo[String(header.po_id)] || [];
                return header;
            });

            return {
                status: 'success',
                page,
                page_size: pageSize,
                total_records: totalRecords,
                total_pages: totalPages,
                data
            };

        } catch (error) {
            return {
                status: 'error',
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        }
    };

    return { post };

});
