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
define(['N/search', 'N/query'], function (search, query) {

    // Helper: format standard NetSuite date to ISO
    var formatToISO = function (dateStr) {
        if (!dateStr) return null;
        var regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i;
        var m = dateStr.match(regex);
        if (!m) return dateStr;

        var day   = parseInt(m[1]);
        var month = parseInt(m[2]) - 1;
        var year  = parseInt(m[3]);
        var hour  = m[4] ? parseInt(m[4]) : 0;
        var min   = m[5] ? parseInt(m[5]) : 0;
        var ampm  = m[6] ? m[6].toUpperCase() : null;

        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        var pad = function(n) { return String(n).padStart(2, '0'); };
        return year + '-' + pad(month + 1) + '-' + pad(day) + 'T' + pad(hour) + ':' + pad(min) + ':00+07:00';
    };

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
                search.createColumn({ name: 'subsidiary' }),
                search.createColumn({ name: 'department' }),
                search.createColumn({ name: 'class' }),
                search.createColumn({ name: 'location' }),
                search.createColumn({ name: 'custbody_cseg_cn_cfi' }),
                search.createColumn({ name: 'custbody_me_description' }),
                search.createColumn({ name: 'status' }),
                search.createColumn({ name: 'lastmodifieddate' })
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
                    subsidiary                         : r.getValue('subsidiary') || null,
                    department                         : r.getValue('department') || null,
                    class                              : r.getValue('class') || null,
                    location                           : r.getValue('location') || null,
                    custbody_cseg_cn_cfi               : r.getValue('custbody_cseg_cn_cfi') || null,
                    custbody_me_description            : r.getValue('custbody_me_description') || null,
                    lines                              : []
                };
            });

            // Ambil array internalid untuk line fetch
            var invcIds = headers.map(function(h) { return h.id; });
            
            if (invcIds.length > 0) {
                var invcIdsStr = invcIds.join(',');

                var lineSql = [
                    "SELECT",
                    "  transaction,",
                    "  linesequencenumber AS line,",
                    "  item,",
                    "  BUILTIN.DF(item) AS item_display,",
                    "  itemtype,",
                    "  ABS(quantity) AS quantity,",
                    "  rate,",
                    "  ABS(netamount) AS netamount,",
                    "  price,",
                    "  BUILTIN.DF(price) AS price_display,",
                    "  custcol_me_tier_price,",
                    "  taxcode,",
                    "  taxrate1,",
                    "  (ABS(netamount) + ABS(NVL(tax1amt, 0))) AS grossamt,",
                    "  tax1amt,",
                    "  memo",
                    "FROM transactionline",
                    "WHERE transaction IN (" + invcIdsStr + ")",
                    "  AND mainline = 'F'",
                    "  AND taxline = 'F'",
                    "  AND itemtype IS NOT NULL", 
                    "ORDER BY transaction, linesequencenumber"
                ].join('\n');

                var lineResult = query.runSuiteQL({ query: lineSql, params: [] }).asMappedResults();

                var linesByInvoice = {};
                for (var j = 0; j < lineResult.length; j++) {
                    var l = lineResult[j];
                    var iId = String(l.transaction);
                    if (!linesByInvoice[iId]) {
                        linesByInvoice[iId] = [];
                    }
                    linesByInvoice[iId].push({
                        line                             : l.line != null ? Number(l.line) : null,
                        item                             : l.item ? String(l.item) : null,
                        item_display                     : l.item_display || null,
                        itemtype                         : l.itemtype || null,
                        memo                             : l.memo || null,
                        quantity                         : l.quantity != null ? Number(l.quantity) : 0,
                        rate                             : l.rate != null ? Number(l.rate) : 0,
                        netamount                        : l.netamount != null ? Number(l.netamount) : 0,
                        price                            : l.price ? String(l.price) : null,
                        price_display                    : l.price_display || null,
                        custcol_me_tier_price            : l.custcol_me_tier_price || null,
                        taxcode                          : l.taxcode ? String(l.taxcode) : null,
                        taxrate1                         : l.taxrate1 || null,
                        grossamt                         : l.grossamt != null ? Number(l.grossamt) : 0,
                        tax1amt                          : l.tax1amt != null ? Number(l.tax1amt) : 0
                    });
                }

                headers.forEach(function(h) {
                    h.lines = linesByInvoice[h.id] || [];
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
