/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Sales Invoices via POST
 * 
 * Approval Status Mapping:
 * 1 = Paid In Full
 * 2 = Pending Approval / Open
 * 3 = Rejected
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "trandate",
   "sort_order" : "DESC",
   "filters": {
     "tranid"         : "INV-0001",
     "approvalstatus" : "1",
     "lastmodified"   : "2026-03-01T00:00:00"
   }
 }
 */
define(['N/search'], function (search) {

    function post(context) {
        try {
            var page      = context.page       || 1;
            var pageSize  = Math.min(context.page_size  || 20, 1000);
            var sortBy    = context.sort_by    || 'trandate';
            var sortOrder = (context.sort_order || 'DESC').toUpperCase();
            var filters   = context.filters    || {};

            var searchFilters = [
                ['type', 'anyof', 'CustInvc'],
                'AND',
                ['mainline', 'is', 'T']
            ];

            if (filters.tranid) {
                searchFilters.push('AND', ['tranid', 'contains', filters.tranid.trim()]);
            }

            if (filters.approvalstatus) {
                var apprStatus = Array.isArray(filters.approvalstatus) ? filters.approvalstatus : [filters.approvalstatus];
                searchFilters.push('AND', ['approvalstatus', 'anyof', apprStatus]);
            }

            if (filters.lastmodified) {
                var d = new Date(filters.lastmodified);
                var nsDate = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            // Kolom yg diurutkan
            var sortColMap = {
                'trandate' : 'trandate',
                'tranid'   : 'tranid',
                'entity'   : 'entity',
                'status'   : 'status'
            };
            var sCol = sortColMap[sortBy] || 'trandate';
            var sDir = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            var columns = [
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'entity' }),
                search.createColumn({ name: 'entityid', join: 'customer' }),
                search.createColumn({ name: 'trandate' }),
                search.createColumn({ name: 'startdate' }),
                search.createColumn({ name: 'enddate' }),
                search.createColumn({ name: 'postingperiod' }),
                search.createColumn({ name: 'otherrefnum' }),
                search.createColumn({ name: 'memo' }),
                search.createColumn({ name: 'custbody_me_related_fulfillment' }),
                search.createColumn({ name: 'terms' }),
                search.createColumn({ name: 'account' }),
                search.createColumn({ name: 'currency' }),
                search.createColumn({ name: 'exchangerate' }),
                search.createColumn({ name: 'custbody_msi_bank_payment_so' }),
                search.createColumn({ name: 'approvalstatus' }),
                search.createColumn({ name: 'custbody_me_wf_created_by' }),
                search.createColumn({ name: 'custbody_me_wf_next_approver_blank' }),
                search.createColumn({ name: 'saleseffectivedate' }),
                search.createColumn({ name: 'createdfrom' }),
                search.createColumn({ name: 'department' }),
                search.createColumn({ name: 'class' }),
                search.createColumn({ name: 'location' }),
                search.createColumn({ name: 'custbody_cseg_cn_cfi' }),
                search.createColumn({ name: 'custbody_me_description' }),
                search.createColumn({ name: 'status' }),
                search.createColumn({ name: 'lastmodifieddate' }),
                search.createColumn({ name: 'subsidiarynohierarchy' })
            ];
            
            // Apply sorting ke salah satu kolom
            for (var i = 0; i < columns.length; i++) {
                if (columns[i].name === sCol) columns[i].sort = sDir;
            }

            var invSearch = search.create({
                type: search.Type.TRANSACTION,
                filters: searchFilters,
                columns: columns
            });

            var pagedData    = invSearch.runPaged({ pageSize: pageSize });
            var pageIndex    = page - 1;
            var totalRecords = pagedData.count;
            var totalPages   = pagedData.pageRanges.length;

            if (totalRecords === 0 || pageIndex >= totalPages) {
                return {
                    status       : 'success',
                    page         : page,
                    page_size    : pageSize,
                    total_records: totalRecords,
                    total_pages  : totalPages,
                    data         : []
                };
            }

            var pageResult = pagedData.fetch({ index: pageIndex });

            var headers = pageResult.data.map(function(r) {
                return {
                    id                                 : String(r.id),
                    tranid                             : r.getValue('tranid'),
                    entity                             : r.getValue('entity') || null,
                    entityid                           : r.getValue({ name: 'entityid', join: 'customer' }) || null,
                    trandate                           : r.getValue('trandate'),
                    startdate                          : r.getValue('startdate'),
                    enddate                            : r.getValue('enddate'),
                    postingperiod                      : r.getValue('postingperiod') || null,
                    postingperiod_display              : r.getText('postingperiod') || null,
                    otherrefnum                        : r.getValue('otherrefnum') || null,
                    memo                               : r.getValue('memo') || null,
                    custbody_me_related_fulfillment    : r.getValue('custbody_me_related_fulfillment') || null,
                    terms                              : r.getValue('terms') || null,
                    account                            : r.getValue('account') || null,
                    account_display                    : r.getText('account') || null,
                    currency                           : r.getValue('currency') || null,
                    currency_display                   : r.getText('currency') || null,
                    exchangerate                       : r.getValue('exchangerate') || null,
                    custbody_msi_bank_payment_so       : r.getValue('custbody_msi_bank_payment_so') || null,
                    custbody_msi_bank_payment_so_display: r.getText('custbody_msi_bank_payment_so') || null,
                    approvalstatus                     : r.getValue('approvalstatus') || null,
                    custbody_me_wf_created_by          : r.getValue('custbody_me_wf_created_by') || null,
                    custbody_me_wf_created_by_display  : r.getText('custbody_me_wf_created_by') || null,
                    custbody_me_wf_next_approver_blank : r.getValue('custbody_me_wf_next_approver_blank') || null,
                    saleseffectivedate                 : r.getValue('saleseffectivedate'),
                    createdfrom                        : r.getValue('createdfrom') || null,
                    createdfrom_display                : r.getText('createdfrom') || null,
                    subsidiary                         : r.getValue('subsidiarynohierarchy') || null,
                    subsidiary_display                 : r.getText('subsidiarynohierarchy') || null,
                    department                         : r.getValue('department') || null,
                    department_display                 : r.getText('department') || null,
                    class                              : r.getValue('class') || null,
                    class_display                      : r.getText('class') || null,
                    location                           : r.getValue('location') || null,
                    location_display                   : r.getText('location') || null,
                    custbody_cseg_cn_cfi               : r.getValue('custbody_cseg_cn_cfi') || null,
                    custbody_me_description            : r.getValue('custbody_me_description') || null,
                    lastmodifieddate                   : r.getValue('lastmodifieddate') || null,
                    lines                              : []
                };
            });

            // Ambil array internalid untuk line fetch
            var invcIds = headers.map(function(h) { return h.id; });
            
            if (invcIds.length > 0) {
                var lineSearch = search.create({
                    type: search.Type.INVOICE,
                    filters: [
                        ['internalid', 'anyof', invcIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F'],
                        'AND',
                        ['item', 'noneof', '@NONE@']
                    ],
                    columns: [
                        search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                        search.createColumn({ name: 'line', sort: search.Sort.ASC }),
                        search.createColumn({ name: 'item' }),
                        search.createColumn({ name: 'type', join: 'item' }),
                        search.createColumn({ name: 'quantity' }),
                        search.createColumn({ name: 'rate' }),
                        search.createColumn({ name: 'amount' }),
                        search.createColumn({ name: 'pricelevel' }),
                        search.createColumn({ name: 'custcol_me_tier_price' }),
                        search.createColumn({ name: 'taxcode' }),
                        search.createColumn({ name: 'taxamount' }),
                        search.createColumn({ name: 'grossamount' }),
                        search.createColumn({ name: 'memo' }),
                        search.createColumn({ name: 'custitem_me_product_category', join: 'item' }),
                        search.createColumn({ name: 'custitem_me_unit_type', join: 'item' })
                    ]
                });

                var linesByInvoice = {};
                lineSearch.run().each(function(r) {
                    var iId = String(r.getValue('internalid'));
                    if (!linesByInvoice[iId]) {
                        linesByInvoice[iId] = [];
                    }


                    linesByInvoice[iId].push({
                        line                 : r.getValue('line') ? Number(r.getValue('line')) : null,
                        item                 : r.getValue('item') || null,
                        item_display         : r.getText('item') || null,
                        itemtype             : r.getValue({ name: 'type', join: 'item' }) || null,
                        memo                 : r.getValue('memo') || null,
                        quantity             : r.getValue('quantity') || null,
                        rate                 : r.getValue('rate') || null,
                        netamount            : r.getValue('amount') || null,
                        price                : r.getValue('pricelevel') || null,
                        price_display        : r.getText('pricelevel') || null,
                        custcol_me_tier_price: r.getValue('custcol_me_tier_price') || null,
                        taxcode              : r.getValue('taxcode') || null,
                        taxrate             : 0, // Fallback placeholder
                        grossamt             : r.getValue('grossamount') || null,
                        taxamount            : r.getValue('taxamount') || null,
                        custitem_me_product_category: r.getValue({ name: 'custitem_me_product_category', join: 'item' }) || null,
                        custitem_me_product_category_display: r.getText({ name: 'custitem_me_product_category', join: 'item' }) || null,
                        custitem_me_unit_type: r.getValue({ name: 'custitem_me_unit_type', join: 'item' }) || null
                    });
                    return true;
                });

                // Robust tax rate lookup
                var taxCodeIds = [];
                Object.keys(linesByInvoice).forEach(function(invId) {
                    linesByInvoice[invId].forEach(function(line) {
                        if (line.taxcode && taxCodeIds.indexOf(line.taxcode) === -1) {
                            taxCodeIds.push(line.taxcode);
                        }
                    });
                });

                var taxRateMap = {};
                if (taxCodeIds.length > 0) {
                    var taxSearch = search.create({
                        type: 'salestaxitem',
                        filters: [['internalid', 'anyof', taxCodeIds]],
                        columns: ['rate']
                    });
                    taxSearch.run().each(function(r) {
                        var rateStr = r.getValue('rate') || "0%";
                        taxRateMap[r.id] = parseFloat(rateStr.replace('%', '')) || 0;
                        return true;
                    });
                    
                    // Fallback search for Tax Groups if needed
                    var missingIds = taxCodeIds.filter(function(id) { return !taxRateMap[id]; });
                    if (missingIds.length > 0) {
                        var groupSearch = search.create({
                            type: 'taxgroup',
                            filters: [['internalid', 'anyof', missingIds]],
                            columns: ['rate']
                        });
                        groupSearch.run().each(function(r) {
                            var rateStr = r.getValue('rate') || "0%";
                            taxRateMap[r.id] = parseFloat(rateStr.replace('%', '')) || 0;
                            return true;
                        });
                    }
                }

                headers.forEach(function(h) {
                    var lines = linesByInvoice[h.id] || [];
                    lines.forEach(function(line) {
                        if (line.taxcode && taxRateMap[line.taxcode] !== undefined) {
                            line.taxrate = taxRateMap[line.taxcode];
                        } else {
                            line.taxrate = 0;
                        }
                    });
                    h.lines = lines;
                });
            }

            return {
                status       : 'success',
                page         : page,
                page_size    : pageSize,
                total_records: totalRecords,
                total_pages  : totalPages,
                data         : headers
            };

        } catch (e) {
            return {
                status : 'error',
                message: e.message || String(e)
            };
        }
    }

    return { post: post };
});
