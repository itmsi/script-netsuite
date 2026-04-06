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
    "status":"PurchOrd:F",       // Filter status PO (opsional) — gunakan kode huruf:
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
}
 */

define(['N/search', 'N/log'], (search, log) => {

    const post = (body) => {

        try {

            body = body || {};

            let page      = body.page      || 1;
            let pageSize  = body.page_size || 20;
            let sortBy    = body.sort_by    || 'internalid';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? false : true; // DESC is default (true)

            // Mapping sort_by suiteql to search column
            const sortMap = {
                't.id': 'internalid',
                'po_id': 'internalid',
                't.tranid': 'tranid',
                'po_number': 'tranid',
                't.trandate': 'trandate',
                'po_date': 'trandate',
                't.lastmodifieddate': 'lastmodifieddate',
                'last_modified': 'lastmodifieddate'
            };
            let searchSortBy = sortMap[sortBy] || sortBy.replace(/^t\./, '');

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
                // Formatting date for search might vary, but ISO is usually accepted or needs M/D/YYYY
                // For simplified "greater than", we often use 'after' or 'onorafter'
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', filtersBody.lastmodified]);
            }

            if (filtersBody.vendor_id) {
                searchFilters.push('AND', ['vendor.internalid', 'anyof', filtersBody.vendor_id]);
            }

            // ── Buat Search Header ─────────────────────────────────────────────
            let headerSearch = search.create({
                type: search.Type.PURCHASE_ORDER,
                filters: searchFilters,
                columns: [
                    search.createColumn({ name: 'internalid', sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }),
                    'tranid', 'trandate', 'status', 'memo', 'entity', 'currency',
                    'amount', 'fxamount', 'lastmodifieddate', 'approvalstatus',
                    'location', 'subsidiary', 'custbody_me_wf_created_by',
                    'custbody_me_wf_in_delegation', 'custbody_me_delegate_approver',
                    'custbody_msi_createdby_api', 'custbody_me_pr_date',
                    'custbody_me_project_location', 'custbody_me_pr_type',
                    'custbody_me_saving_type', 'custbody_me_pr_number',
                    'custbody_me_description', 'intercotransaction', 'terms',
                    'duedate', 'otherrefnum', 'custbody_me_wf_next_approver_blank',
                    'customform', 'nextapprover'
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
            let foundPoIds   = [];

            searchPage.data.forEach(res => {
                foundPoIds.push(res.id);
                pagedHeaders.push({
                    po_id:                             res.id,
                    po_number:                         res.getValue('tranid'),
                    po_date:                           res.getValue('trandate'),
                    po_status:                         res.getValue('status'),
                    po_status_label:                   res.getText('status'),
                    memo:                              res.getValue('memo'),
                    vendor_id:                         res.getValue('entity'),
                    vendor_name:                       res.getText('entity'),
                    currency_id:                       res.getValue('currency'),
                    currency_symbol:                   res.getText('currency'),
                    foreigntotal:                      res.getValue('fxamount'),
                    total:                             res.getValue('amount'),
                    last_modified:                     res.getValue('lastmodifieddate'),
                    approvalstatus:                    res.getValue('approvalstatus'),
                    custbody_me_wf_created_by:         res.getValue('custbody_me_wf_created_by'),
                    custbody_me_wf_in_delegation:      res.getValue('custbody_me_wf_in_delegation'),
                    custbody_me_delegate_approver:     res.getValue('custbody_me_delegate_approver'),
                    custbody_msi_createdby_api:        res.getValue('custbody_msi_createdby_api'),
                    custbody_me_pr_date:               res.getValue('custbody_me_pr_date'),
                    custbody_me_project_location:      res.getValue('custbody_me_project_location'),
                    custbody_me_pr_type:               res.getValue('custbody_me_pr_type'),
                    custbody_me_saving_type:           res.getValue('custbody_me_saving_type'),
                    custbody_me_pr_number:             res.getValue('custbody_me_pr_number'),
                    custbody_me_description:           res.getValue('custbody_me_description'),
                    intercotransaction:                res.getValue('intercotransaction'),
                    terms:                             res.getValue('terms'),
                    duedate:                           res.getValue('duedate'),
                    otherrefnum:                       res.getValue('otherrefnum'),
                    subsidiary:                        res.getValue('subsidiary'),
                    subsidiary_display:                res.getText('subsidiary'),
                    location:                          res.getValue('location'),
                    location_display:                  res.getText('location'),
                    custbody_me_wf_next_approver_blank: res.getValue('custbody_me_wf_next_approver_blank'),
                    custbody_me_wf_next_approver_blank_display: res.getText('custbody_me_wf_next_approver_blank'),
                    customform:                        res.getValue('customform'),
                    customform_display:                res.getText('customform')
                });
            });

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
                        'internalid', 'line', 'item', 'itemtype', 'quantity', 'quantitybilled', 
                        'rate', 'amount', 'taxamount', 'taxcode', 'memo', 
                        'location', 'department', 'class', 
                        'matchbilltoreceipt', 'expectedreceiptdate', 'custcol_4601_witaxapplies'
                    ]
                });

                lineSearch.run().each(res => {
                    let poId = res.getValue('internalid');
                    if (!linesByPo[poId]) linesByPo[poId] = [];
                    
                    let netAmount = Number(res.getValue('amount')) || 0;
                    let taxAmount = Number(res.getValue('taxamount')) || 0;

                    linesByPo[poId].push({
                        transaction:        poId,
                        linesequencenumber: res.getValue('line'),
                        item:               res.getValue('item'),
                        item_display:       res.getText('item'),
                        itemtype:           res.getValue('itemtype'),
                        quantity:           res.getValue('quantity'),
                        quantitybilled:     res.getValue('quantitybilled'),
                        rate:               res.getValue('rate'),
                        netamount:          netAmount,
                        tax1amt:            taxAmount,
                        grossamt:           Math.abs(netAmount) + Math.abs(taxAmount),
                        taxcode:            res.getValue('taxcode'),
                        taxcode_display:    res.getText('taxcode'),
                        taxrate1:           res.getValue('taxrate'),
                        memo:               res.getValue('memo'),
                        location:           res.getValue('location'),
                        location_display:   res.getText('location'),
                        department:         res.getValue('department'),
                        department_display: res.getText('department'),
                        class:              res.getValue('class'),
                        class_display:      res.getText('class'),
                        units:              res.getText('units'),
                        units_display:      res.getText('units'),
                        isbillable:         res.getValue('isbillable'),
                        isclosed:           res.getValue('isclosed'),
                        matchbilltoreceipt: res.getValue('matchbilltoreceipt'),
                        expectedreceiptdate: res.getValue('expectedreceiptdate'),
                        custcol_4601_witaxapplies: res.getValue('custcol_4601_witaxapplies')
                    });
                    return true;
                });
            }

            // ── Gabungkan header + lines ───────────────────────────────────────
            let data = pagedHeaders.map(header => {
                header.lines = linesByPo[header.po_id] || [];
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
