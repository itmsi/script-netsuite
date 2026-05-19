/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Customer Return (Return Authorization) via POST
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "trandate",
   "sort_order" : "DESC",
   "filters": {
     "lastmodified": "2026-03-01T00:00:00"
   }
 }
 *
 * =============================================
 * STATUS CODES
 * status_code | status_name
 * ------------|------------------------------------------
 A           | Return Authorization : Pending Approval
 B           | Return Authorization : Open
 C           | Return Authorization : Cancelled
 D           | Return Authorization : Rejected
 E           | Return Authorization : Partially Applied
 F           | Return Authorization : Pending Credit
 G           | Return Authorization : Credited
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
                search.createColumn({ name: 'datecreated' }),
                search.createColumn({ name: 'otherrefnum' }),
                search.createColumn({ name: 'saleseffectivedate' }),
                search.createColumn({ name: 'salesrep' }),
                search.createColumn({ name: 'createdfrom' }),
                search.createColumn({ name: 'subsidiary' }),
                search.createColumn({ name: 'location' }),
                search.createColumn({ name: 'class' }),
                search.createColumn({ name: 'department' }),
                search.createColumn({ name: 'custbody_cseg_cn_cfi' })
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
                type   : search.Type.RETURN_AUTHORIZATION,
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

            // ── Map hasil (Headers) ──────────────────────────────────────────
            var pagedHeaders = [];
            var foundIds     = [];

            pageResult.data.forEach(function (r) {
                foundIds.push(r.id);
                pagedHeaders.push({
                    id           : String(r.id),
                    tranid       : r.getValue('tranid'),
                    customer_id  : r.getValue('entity')  || null,
                    customer_name: r.getText('entity')   || null,
                    tran_date    : formatToISO(r.getValue('trandate')),
                    status_code  : r.getValue('status'),
                    status_name  : r.getText('status'),
                    memo         : r.getValue('memo')    || null,
                    last_modified: formatToISO(r.getValue('lastmodifieddate')),
                    datecreated  : formatToISO(r.getValue('datecreated')),

                    otherrefnum                 : r.getValue('otherrefnum') || null,
                    saleseffectivedate          : formatToISO(r.getValue('saleseffectivedate')),
                    salesrep                    : r.getValue('salesrep') || null,
                    salesrep_display            : r.getText('salesrep') || null,
                    createdfrom                 : r.getValue('createdfrom') || null,
                    createdfrom_display         : r.getText('createdfrom') || null,
                    subsidiary                  : r.getValue('subsidiary') || null,
                    subsidiary_display          : r.getText('subsidiary') || null,
                    location                    : r.getValue('location') || null,
                    location_display            : r.getText('location') || null,
                    class                       : r.getValue('class') || null,
                    class_display               : r.getText('class') || null,
                    departement                 : r.getValue('department') || null,
                    departement_display         : r.getText('department') || null,
                    custbody_cseg_cn_cfi        : r.getValue('custbody_cseg_cn_cfi') || null,
                    custbody_cseg_cn_cfi_display: r.getText('custbody_cseg_cn_cfi') || null,
                    
                    items        : []
                });
            });

            // ── Search Items ──────────────────────────────────────────────────
            var itemsByTran = {};
            if (foundIds.length > 0) {
                // Untuk custom columns bisa gagal kalau tidak ada di instance,
                // tambahkan kolom dengan createColumn agar lebih aman.
                var itemColumns = [
                    'internalid', 'line', 'lineuniquekey', 'item', 'quantity', 'quantityshiprecv', 'quantitybilled',
                    'unit', 'memo', 'pricelevel', 'rate', 'amount', 'taxcode',
                    'grossamount', 'taxamount', 'options', 'department', 'class', 'location', 'closed',
                    'custcol_me_tier_price', 'custcol_cseg_cn_cfi',
                    search.createColumn({ name: 'inventorynumber', join: 'inventorydetail' }),
                    search.createColumn({ name: 'quantity', join: 'inventorydetail' }),
                    search.createColumn({ name: 'binnumber', join: 'inventorydetail' })
                ];

                try {
                    var itemSearch = search.create({
                        type: search.Type.RETURN_AUTHORIZATION,
                        filters: [
                            ['internalid', 'anyof', foundIds],
                            'AND',
                            ['mainline', 'is', 'F'],
                            'AND',
                            ['taxline', 'is', 'F'],
                            'AND',
                            ['shipping', 'is', 'F']
                        ],
                        columns: itemColumns
                    });

                    itemSearch.run().each(function (res) {
                        var tranId = res.getValue('internalid');
                        var lineId = res.getValue('lineuniquekey');

                        if (!itemsByTran[tranId]) {
                            itemsByTran[tranId] = { lines: [], map: {} };
                        }
                        
                        var tranObj = itemsByTran[tranId];

                        // Dapatkan data Inventory Detail dari join
                        var invNum = res.getValue({ name: 'inventorynumber', join: 'inventorydetail' });
                        var invNumDisplay = res.getText({ name: 'inventorynumber', join: 'inventorydetail' });
                        var invQty = res.getValue({ name: 'quantity', join: 'inventorydetail' });
                        var invBin = res.getValue({ name: 'binnumber', join: 'inventorydetail' });
                        var invBinDisplay = res.getText({ name: 'binnumber', join: 'inventorydetail' });

                        var invDetail = null;
                        if (invNum || invQty || invBin) {
                            invDetail = {
                                inventory_number: invNum,
                                inventory_number_display: invNumDisplay,
                                quantity: invQty,
                                bin_number: invBin,
                                bin_number_display: invBinDisplay
                            };
                        }

                        // Jika item baris ini belum di-push ke array (grouping by line)
                        if (!tranObj.map[lineId]) {
                            var newItem = {
                                line_id         : lineId,
                                line            : res.getValue('line'),
                                item            : res.getValue('item'),
                                item_display    : res.getText('item'),
                                returned        : res.getValue('quantityshiprecv'),
                                refunded        : res.getValue('quantitybilled'),
                                quantity        : Math.abs(res.getValue('quantity')),
                                units           : res.getValue('unit'),
                                units_display   : res.getText('unit'),
                                inventory_details: [],
                                description     : res.getValue('memo'),
                                tier_price      : res.getValue('custcol_me_tier_price'),
                                price_level     : res.getValue('pricelevel'),
                                price_level_display : res.getText('pricelevel'),
                                unit_price      : res.getValue('rate'),
                                amount          : Math.abs(res.getValue('amount')),
                                tax_code        : res.getValue('taxcode'),
                                tax_code_display: res.getText('taxcode'),
                                gross_amt       : res.getValue('grossamount'),
                                tax_amt         : res.getValue('taxamount'),
                                options         : res.getValue('options'),
                                department      : res.getValue('department'),
                                department_display: res.getText('department'),
                                class           : res.getValue('class'),
                                class_display   : res.getText('class'),
                                location        : res.getValue('location'),
                                location_display: res.getText('location'),
                                closed          : res.getValue('closed'),
                                china_cash_flow_item: res.getValue('custcol_cseg_cn_cfi'),
                                china_cash_flow_item_display: res.getText('custcol_cseg_cn_cfi')
                            };

                            if (invDetail) {
                                newItem.inventory_details.push(invDetail);
                            }

                            tranObj.lines.push(newItem);
                            tranObj.map[lineId] = newItem;
                        } else {
                            // Jika line ini sudah ada, cukup tambahkan inventory detail baru
                            if (invDetail) {
                                tranObj.map[lineId].inventory_details.push(invDetail);
                            }
                        }
                        return true;
                    });
                } catch (itemErr) {
                    // Fallback jika ada custom column yang tidak dikenali/tidak ada
                    // Kembalikan header tanpa membatalkan script sepenuhnya, atau kembalikan error
                    return {
                        status: 'error',
                        message: 'Error di mapping items (kemungkinan kolom custom tidak ditemukan): ' + (itemErr.message || JSON.stringify(itemErr))
                    };
                }
            }

            // Gabungkan items ke dalam pagedHeaders
            var data = pagedHeaders.map(function(header) {
                if (itemsByTran[header.id]) {
                    header.items = itemsByTran[header.id].lines;
                }
                return header;
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
