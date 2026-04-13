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

            // Mapping sort_by suiteql to search column
            const sortMap = {
                't.id': 'internalid',
                'po_id': 'internalid',
                't.tranid': 'tranid',
                'po_number': 'tranid',
                't.trandate': 'trandate',
                'po_date': 'trandate',
                'lastmodified': 'lastmodifieddate'
            };

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
                    'custbody_me_saving_type', 'custbody_me_pr_number', 'intercotransaction', 'terms',
                    'duedate', 'otherrefnum', 'customform', 'class', 
                    search.createColumn({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }),
                    'subsidiarynohierarchy', 'custbody_me_validity_date', 'department'
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
                    last_modified:                     formatToISO(res.getValue('lastmodifieddate')),
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
                    intercotransaction:                res.getValue('intercotransaction'),
                    terms:                             res.getValue('terms'),
                    terms_display:                     res.getText('terms'),
                    duedate:                           res.getValue('duedate'),
                    otherrefnum:                       res.getValue('otherrefnum'),
                    subsidiary:                        res.getValue('subsidiarynohierarchy'),
                    subsidiary_display:                res.getText('subsidiarynohierarchy'),
                    location:                          res.getValue('location'),
                    location_display:                  res.getText('location'),
                    customform:                        res.getValue('customform'),
                    customform_display:                res.getText('customform'),
                    class:                             res.getValue('class'),
                    class_display:                     res.getText('class'),
                    nextapprover:                      res.getText({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }),
                    custbody_me_validity_date:         res.getValue('custbody_me_validity_date'),
                    department:                        res.getValue('department'),
                    department_display:                res.getText('department')
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
                        'matchbilltoreceipt', 'expectedreceiptdate', 'custcol_4601_witaxapplies', 'custcol_msi_fob', 'custcol_me_landed_cost'
                    ]
                });

                lineSearch.run().each(res => {
                    let poId = res.getValue('internalid');
                    if (!linesByPo[poId]) linesByPo[poId] = [];

                    linesByPo[poId].push({
                        transaction:        poId,
                        linesequencenumber: res.getValue('line'),
                        item:               res.getValue('item'),
                        item_display:       res.getText('item'),
                        itemtype:           res.getValue('itemtype'),
                        quantity:           res.getValue('quantity'),
                        quantitybilled:     res.getValue('quantitybilled'),
                        rate:               res.getValue('rate'),
                        netamount:          res.getValue('amount'),
                        tax1amt:            Math.abs(res.getValue('taxamount')),
                        grossamt:           Math.abs(res.getValue('amount')) + Math.abs(res.getValue('taxamount')),
                        taxcode:            res.getValue('taxcode'),
                        taxcode_display:    res.getText('taxcode'),
                        taxrate1:           res.getValue('taxrate'),
                        description:        res.getValue('memo'),
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
                        custcol_4601_witaxapplies: res.getValue('custcol_4601_witaxapplies'),
                        custcol_msi_fob: res.getValue('custcol_msi_fob'),
                        custcol_me_landed_cost: res.getValue('custcol_me_landed_cost')
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
