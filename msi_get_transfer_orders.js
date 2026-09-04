/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Transfer Order via POST
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "trandate",
   "sort_order" : "DESC",
   "filters": {
     "id": ["12345"],
     "tranid": "TO-0001",
     "status": "B", // B, F, G
     "lastmodified": "2026-03-01T00:00:00"
   }
 }
 *
 * =============================================
 * STATUS CODES
 * B → Transfer Order : Pending Fulfillment
 * F → Transfer Order : Pending Receipt
 * G → Transfer Order : Received
 * =============================================
 */
define(['N/search', 'N/query', 'N/log'], function (search, query, log) {

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

            if (ampm === 'PM' && hour !== 12) hour += 12;
            if (ampm === 'AM' && hour === 12) hour = 0;

            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`;
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

            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+07:00`;
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

            var page = context.page || 1;
            var pageSize = context.page_size || 20;
            var sortBy = context.sort_by || 'trandate';
            var sortOrder = context.sort_order || 'DESC';
            var filters = context.filters || {};

            // ── Sort mapping ──────────────────────────────────────────────────
            var sortMap = {
                'trandate': 'trandate',
                'lastmodifieddate': 'lastmodifieddate',
                'tranid': 'tranid'
            };
            var sortColName = sortMap[sortBy] || 'trandate';
            var sortDir = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            // ── Build filters ─────────────────────────────────────────────────
            var searchFilters = [
                ['mainline', 'is', 'T']
            ];

            if (filters.lastmodified) {
                // Ambil komponen tanggal/jam APA ADANYA dari string ISO input
                // (bukan lewat new Date() + local getter) - getter lokal itu
                // bergantung ke timezone runtime yang gak konsisten, dan
                // sebelumnya jam dibuang total. Asumsi: offset di payload
                // sama dengan timezone akun NetSuite (WIB, +07:00).
                var lmMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(filters.lastmodified));
                if (!lmMatch) {
                    throw new Error("filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + filters.lastmodified + "'.");
                }

                var lmSqlDate = lmMatch[1] + '-' + lmMatch[2] + '-' + lmMatch[3] + ' ' +
                    lmMatch[4] + ':' + lmMatch[5] + ':' + (lmMatch[6] || '00');

                var lmFormula = "formulanumeric: CASE WHEN {lastmodifieddate} >= TO_DATE('" + lmSqlDate + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END";
                searchFilters.push('AND', [lmFormula, 'equalto', '1']);
            }

            if (filters.id || filters.internalid) {
                searchFilters.push('AND', ['internalid', 'anyof', filters.id || filters.internalid]);
            }

            if (filters.tranid) {
                searchFilters.push('AND', ['tranid', 'is', filters.tranid]);
            }

            // ── Build columns ─────────────────────────────────────────────────
            var columns = [
                search.createColumn({ name: 'internalid' }),
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'trandate' }),
                search.createColumn({ name: 'status' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'lastmodifieddate' }),
                search.createColumn({ name: 'datecreated' }),
                search.createColumn({ name: 'location' }),           // from location
                search.createColumn({ name: 'transferlocation' }),   // to location
                search.createColumn({ name: 'subsidiary' }),
                search.createColumn({ name: 'firmed' }),                          // Firmed
                search.createColumn({ name: 'incoterm' }),
                search.createColumn({ name: 'custbody_me_logistic_vendor' }),   // Logistic Vendor
                search.createColumn({ name: 'salesrep' }),                       // Employee (alias search column-nya 'salesrep', bukan 'employee')
                search.createColumn({ name: 'department' }),
                search.createColumn({ name: 'class' }),
                search.createColumn({ name: 'custbody_me_inv_customer' }),      // Customer
                search.createColumn({ name: 'custbody_msi_createdby_api' }),
                search.createColumn({ name: 'createdby' }),                     // Created By (NetSuite native)
                search.createColumn({ name: 'amount' }),                        // Summary Total
                search.createColumn({ name: 'customform' })
            ];

            // Apply sort ke kolom yang sesuai
            for (var i = 0; i < columns.length; i++) {
                if (columns[i].name === sortColName) {
                    columns[i].sort = sortDir;
                    break;
                }
            }

            // ── Run search (header) ───────────────────────────────────────────
            var pagedData = search.create({
                type: search.Type.TRANSFER_ORDER,
                filters: searchFilters,
                columns: columns
            }).runPaged({ pageSize: pageSize });

            var totalRecords = pagedData.count;
            var totalPages = pagedData.pageRanges.length;

            if (totalRecords === 0 || page > totalPages) {
                return {
                    status: 'success',
                    page: page,
                    page_size: pageSize,
                    total_records: totalRecords,
                    total_pages: totalPages,
                    data: []
                };
            }

            var pageResult = pagedData.fetch({ index: page - 1 });

            // ── Build map dari hasil header search ────────────────────────────
            var map = {};
            pageResult.data.forEach(function (r) {
                var fromLocId = r.getValue('location');
                var toLocId = r.getValue('transferlocation');
                var subsidiaryId = r.getValue('subsidiary');
                var incotermId = r.getValue('incoterm');
                var logisticVendorId = r.getValue('custbody_me_logistic_vendor');
                var employeeId = r.getValue('salesrep');
                var departmentId = r.getValue('department');
                var classId = r.getValue('class');
                var customerId = r.getValue('custbody_me_inv_customer');
                var createdById = r.getValue('createdby');

                map[String(r.id)] = {
                    id: String(r.id),
                    tranid: r.getValue('tranid'),
                    tran_date: r.getValue('trandate'),
                    status_code: r.getValue('status'),
                    status_name: r.getText('status'),
                    from_location_id: fromLocId ? Number(fromLocId) : null,
                    from_location_name: r.getText('location') || null,
                    to_location_id: toLocId ? Number(toLocId) : null,
                    to_location_name: r.getText('transferlocation') || null,
                    memo: r.getValue('memo') || null,
                    subsidiary_id: subsidiaryId ? Number(subsidiaryId) : null,
                    subsidiary_name: r.getText('subsidiary') || null,
                    firmed: r.getValue('firmed') === true || r.getValue('firmed') === 'T',
                    incoterm_id: incotermId ? Number(incotermId) : null,
                    incoterm_name: r.getText('incoterm') || null,
                    logistic_vendor_id: logisticVendorId ? Number(logisticVendorId) : null,
                    logistic_vendor_name: r.getText('custbody_me_logistic_vendor') || null,
                    employee_id: employeeId ? Number(employeeId) : null,
                    employee_name: r.getText('salesrep') || null,
                    department_id: departmentId ? Number(departmentId) : null,
                    department_name: r.getText('department') || null,
                    class_id: classId ? Number(classId) : null,
                    class_name: r.getText('class') || null,
                    customer_id: customerId ? Number(customerId) : null,
                    customer_name: r.getText('custbody_me_inv_customer') || null,
                    custbody_msi_createdby_api: r.getValue('custbody_msi_createdby_api'),
                    created_by_id: createdById ? Number(createdById) : null,
                    created_by_name: r.getText('createdby') || null,
                    use_item_cost_as_transfer_cost: false, // di-isi dari SuiteQL, lihat blok di bawah
                    total: (function (v) { return v !== null && v !== '' ? Math.abs(Number(v)) : 0; })(r.getValue('amount')),
                    customform: r.getValue('customform') ? Number(r.getValue('customform')) : null,
                    customform_display: r.getText('customform') || null,
                    last_modified: formatToISO(r.getValue('lastmodifieddate')),
                    datecreated: formatToISO(r.getValue('datecreated')),
                    items: [],
                    files: []
                };
            });

            var ids = Object.keys(map);

            // ── useitemcostastransfercost via SuiteQL ───────────────────────────
            // Field ini valid di record.getValue() & kolom asli tabel 'transaction',
            // tapi TIDAK diekspos sebagai search.createColumn (sudah dicek: nama asli
            // maupun beberapa alias semuanya invalid) → diambil lewat N/query.
            var uictPlaceholders = ids.map(function () { return '?'; }).join(',');
            var uictResults = query.runSuiteQL({
                query: 'SELECT id, useitemcostastransfercost FROM transaction WHERE id IN (' + uictPlaceholders + ')',
                params: ids
            }).asMappedResults();
            uictResults.forEach(function (row) {
                var toId = String(row.id);
                if (map[toId]) {
                    map[toId].use_item_cost_as_transfer_cost = row.useitemcostastransfercost === 'T';
                }
            });

            // ── Search Custom Attach Files via N/search ─────────────────────────
            // Pola sama seperti msi_get_purchase_orders.js / msi_get_sales_orders.js
            try {
                // custrecord_msi_transaction_id = Free-Form Text, tidak support ANYOF
                var idOrFilters = [];
                ids.forEach(function (id, i) {
                    if (i > 0) idOrFilters.push('OR');
                    idOrFilters.push(['custrecord_msi_transaction_id', 'is', String(id)]);
                });

                var fileSearch = search.create({
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

                fileSearch.run().each(function (r) {
                    var toId = r.getValue('custrecord_msi_transaction_id');
                    if (!toId || !map[toId]) return true;
                    map[toId].files.push({
                        id: r.id,
                        fileName: r.getValue('name'),
                        fileUrl: r.getValue('custrecord_msi_web_url'),
                        created_by_api: r.getValue('custrecord_msi_createdby_api_file')
                    });
                    return true;
                });
            } catch (e) {
                log.error('File Search Error', e.message);
            }

            // ── Line items via Search ─────────────────────────────────────────
            // - Field native (quantitycommitted, quantitypicked, dll) diambil dari TO langsung.
            // - quantityreceived TIDAK valid di TO search → diambil dari ItemRcpt terpisah.
            if (ids.length > 0) {

                // Step 1: Query TO line items dengan field native.
                //
                // ROOT CAUSE:
                //   - NetSuite membuat 3 sub-rows per UI line di Transfer Order:
                //       [A] "phantom" source row → committed=0 (internal tracking)
                //       [B] "real" source row    → menyimpan Fulfilled Qty (quantityshiprecv)
                //       [C] "real" dest row      → menyimpan Received Qty (quantityshiprecv)
                //
                // FIX:
                //   1. Ambil semua baris, group by (toId + itemId)
                //   2. Pisahkan source rows (from_location) dan dest rows (to_location)
                //   3. Pasangkan (zip) "real" source rows dengan dest rows
                //   4. Ambil Received Qty dari dest row!
                var lineSearch = search.create({
                    type: search.Type.TRANSFER_ORDER,
                    filters: [
                        ['internalid', 'anyof', ids],
                        'AND', ['mainline', 'is', 'F'],
                        'AND', ['taxline', 'is', 'F'],
                        'AND', ['item.type', 'noneof', '@NONE@']
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid' }),
                        search.createColumn({ name: 'line' }),          // line sequence (untuk sort & group)
                        search.createColumn({ name: 'item' }),
                        search.createColumn({ name: 'memo' }),
                        search.createColumn({ name: 'quantity' }),
                        search.createColumn({ name: 'quantitycommitted' }),
                        search.createColumn({ name: 'quantitypicked' }),
                        search.createColumn({ name: 'quantitypacked' }),
                        search.createColumn({ name: 'quantityshiprecv' }), // Fulfilled (source) atau Received (dest)
                        search.createColumn({ name: 'location' }),
                        search.createColumn({ name: 'rate' }),              // Transfer Price
                        search.createColumn({ name: 'amount' }),
                        search.createColumn({ name: 'expectedreceiptdate' }),
                        search.createColumn({ name: 'orderpriority' }),
                        search.createColumn({ name: 'commitmentfirm' }),   // Commitment Confirmed
                        search.createColumn({ name: 'closed' }),            // alias search column untuk 'isclosed'
                        search.createColumn({ name: 'custitem_me_unit_type', join: 'item' }), // Units (dari Item record, 'units' native TIDAK valid di TO)
                        search.createColumn({ name: 'displayname', join: 'item' })
                    ]
                });

                // key: toId + '_' + itemId → array of all rows for this item
                var lineGroups = {};

                lineSearch.run().each(function (r) {
                    var toId = String(r.id);
                    if (!map[toId]) return true;

                    var itemId = r.getValue('item');
                    if (!itemId) return true;

                    var locId  = r.getValue('location');
                    var locNum = locId ? Number(locId) : null;
                    var lineSeq = Number(r.getValue('line')) || 0;

                    var parseQty = function (val) {
                        return (val !== null && val !== '') ? Math.abs(Number(val)) : 0;
                    };

                    var qty       = parseQty(r.getValue('quantity'));
                    var committed = parseQty(r.getValue('quantitycommitted'));
                    var picked    = parseQty(r.getValue('quantitypicked'));
                    var packed    = parseQty(r.getValue('quantitypacked'));
                    var shiprecv  = parseQty(r.getValue('quantityshiprecv'));
                    var backorder = Math.max(0, qty - committed - picked);

                    var rateVal   = r.getValue('rate');
                    var amountVal = r.getValue('amount');
                    var expReceiptDate = r.getValue('expectedreceiptdate');

                    var grpKey = toId + '_' + String(itemId);
                    if (!lineGroups[grpKey]) lineGroups[grpKey] = [];
                    lineGroups[grpKey].push({
                        _toId:              toId,
                        _seq:               lineSeq,
                        _locNum:            locNum,
                        item_id:            Number(itemId),
                        item_name:          r.getText('item'),
                        item_displayname:   r.getValue({ name: 'displayname', join: 'item' }) || null,
                        description:        r.getValue('memo') || null,
                        quantity:           qty,
                        committed:          committed,
                        shipped:            shiprecv, // sbg temporary, nanti direname jika ini dest row
                        picked:             picked,
                        packed:             packed,
                        fulfilled:          shiprecv,
                        received:           0,        // akan di-isi dari dest row
                        backorder:          backorder,
                        transfer_price:     rateVal !== null && rateVal !== '' ? Number(rateVal) : 0,
                        amount:             amountVal !== null && amountVal !== '' ? Math.abs(Number(amountVal)) : 0,
                        units:              r.getText({ name: 'custitem_me_unit_type', join: 'item' }) || null,
                        expected_receipt_date: expReceiptDate || null,
                        order_priority:     r.getValue('orderpriority') || null,
                        commitment_confirmed: r.getValue('commitmentfirm') === true || r.getValue('commitmentfirm') === 'T',
                        closed:             r.getValue('closed') === true || r.getValue('closed') === 'T',
                        from_location_id:   map[toId].from_location_id,
                        from_location_name: map[toId].from_location_name
                    });

                    return true;
                });

                var realLines = [];
                Object.keys(lineGroups).forEach(function (grpKey) {
                    // Sort by sequence agar terurut (Phantom -> Real Source -> Real Dest)
                    var rows = lineGroups[grpKey].sort(function (a, b) { return a._seq - b._seq; });
                    var toId = grpKey.split('_')[0];
                    var fromLoc = map[toId].from_location_id;
                    
                    var srcRows  = rows.filter(function (r) { return r._locNum === fromLoc; });
                    var destRows = rows.filter(function (r) { return r._locNum !== fromLoc; });
                    
                    var realSrcRows = [];
                    if (destRows.length > 0 && srcRows.length % destRows.length === 0) {
                        var multiplier = srcRows.length / destRows.length; // biasanya 2
                        for (var i = 0; i < destRows.length; i++) {
                            // Ambil baris source terakhir dari tiap chunk (itu adalah "real" source line)
                            realSrcRows.push(srcRows[i * multiplier + (multiplier - 1)]);
                        }
                    } else {
                        // Fallback jika tidak ada phantom lines, atau tidak imbang
                        var takeCount = destRows.length > 0 ? destRows.length : srcRows.length;
                        realSrcRows = srcRows.slice(-takeCount); 
                    }
                    
                    for (var j = 0; j < realSrcRows.length; j++) {
                        var lineObj = realSrcRows[j];
                        if (destRows[j]) {
                            // field quantityshiprecv pada destination row adalah Received Qty!
                            lineObj.received = destRows[j].shipped;
                            // Expected Receipt Date & Closed lebih relevan dari sisi dest (penerimaan)
                            if (!lineObj.expected_receipt_date && destRows[j].expected_receipt_date) {
                                lineObj.expected_receipt_date = destRows[j].expected_receipt_date;
                            }
                            if (destRows[j].closed) {
                                lineObj.closed = destRows[j].closed;
                            }
                        }
                        realLines.push(lineObj);
                    }
                });

                // Sort semua real lines by sequence untuk mempertahankan urutan UI
                realLines.sort(function (a, b) { return a._seq - b._seq; });

                realLines.forEach(function (e) {
                    var toId = e._toId;
                    var n    = map[toId].items.length;
                    map[toId].items.push({
                        line_number:        n + 1,
                        item_id:            e.item_id,
                        item_name:          e.item_name,
                        item_displayname:   e.item_displayname,
                        description:        e.description,
                        quantity:           e.quantity,
                        committed:          e.committed,
                        shipped:            e.shipped,
                        picked:             e.picked,
                        packed:             e.packed,
                        fulfilled:          e.fulfilled,
                        received:           e.received,
                        backorder:          e.backorder,
                        transfer_price:     e.transfer_price,
                        amount:             e.amount,
                        units:              e.units,
                        expected_receipt_date: formatToISO(e.expected_receipt_date),
                        order_priority:     e.order_priority,
                        commitment_confirmed: e.commitment_confirmed,
                        closed:             e.closed,
                        from_location_id:   e.from_location_id,
                        from_location_name: e.from_location_name
                    });
                });
            }

            var data = ids.map(function (k) { return map[k]; });

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
    }

    return { post: post };
});