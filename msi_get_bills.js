/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET list Vendor Bill menggunakan method POST dengan search
 *
 =============================================================
 REQUEST BODY PAYLOAD
 =============================================================
 *
 {
   "page":       {number}  - Halaman yang diminta (default: 1)
   "page_size":  {number}  - Jumlah record per halaman (default: 20)
   "sort_by":    {string}  - Field untuk sorting (default: "internalid")
   "sort_order": {string}  - Arah sorting: "ASC" | "DESC" (default: "DESC")
 
   "filters": {
     "bill_ids":           {number[]} - Filter berdasarkan internal ID bill (array)
     "tranid":             {string}   - Filter berdasarkan Bill Number (tranid)
     "transactionnumber":  {string}   - Filter berdasarkan Transaction Number
     "vendor_id":          {number}   - Filter berdasarkan internal ID vendor (entity)
     "lastmodified":       {string}   - Filter tanggal diubah (opsional, cth: "2026-03-31T23:59:00+07:00")
   }
 }
 *
 Contoh:
 {
   "page": 1,
   "page_size": 20,
   "sort_by": "trandate",
   "sort_order": "DESC",
   "filters": {
     "vendor_id": 123,
     "tranid": "BILL-0001"
   }
 }
 */

define(['N/search'], (search) => {

    const formatToISO = (dateStr) => {
        if (!dateStr) return null;

        // 1. FORMAT: DD/MM/YYYY HH:mm AM/PM
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

        // 2. FORMAT: DD/MM/YYYY (tanpa jam)
        var shortRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
        var m2 = dateStr.match(shortRegex);
        if (m2) {
            var day   = parseInt(m2[1]);
            var month = parseInt(m2[2]);
            var year  = parseInt(m2[3]);
            return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00+07:00`;
        }

        // 3. FALLBACK
        var d = new Date(dateStr);
        if (isNaN(d)) return dateStr;
        return d.toISOString();
    };

    const post = (body) => {
        try {
            body = body || {};

            let page      = body.page      || 1;
            let pageSize  = body.page_size || 20;
            let sortBy    = body.sort_by   || 'internalid';
            let sortOrder = (body.sort_order || 'DESC').toUpperCase() === 'ASC' ? false : true;

            let filtersBody = body.filters || {};

            let searchFilters = [
                ['type', 'anyof', 'VendBill'],
                'AND',
                ['mainline', 'is', 'T']
            ];

            if (filtersBody.bill_ids && Array.isArray(filtersBody.bill_ids) && filtersBody.bill_ids.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.bill_ids]);
            }
            if (filtersBody.tranid) {
                searchFilters.push('AND', ['tranid', 'is', filtersBody.tranid]);
            }
            if (filtersBody.transactionnumber) {
                searchFilters.push('AND', ['transactionnumber', 'is', filtersBody.transactionnumber]);
            }
            if (filtersBody.vendor_id) {
                searchFilters.push('AND', ['entity', 'anyof', filtersBody.vendor_id]);
            }
            if (filtersBody.lastmodified) {
                var d = new Date(filtersBody.lastmodified);
                var hours = d.getHours();
                var minutes = d.getMinutes();
                var ampm = hours >= 12 ? 'pm' : 'am';
                hours = hours % 12;
                hours = hours ? hours : 12; // 0 jam => 12
                var minStr = minutes < 10 ? '0' + minutes : minutes;
                var strTime = hours + ':' + minStr + ' ' + ampm;
                var nsDate = d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + strTime;
                searchFilters.push('AND', ['lastmodifieddate', 'onorafter', nsDate]);
            }

            let headerSearch = search.create({
                type: search.Type.VENDOR_BILL,
                filters: searchFilters,
                columns: [
                    search.createColumn({ name: sortBy, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }),
                    'internalid',
                    'transactionnumber', 'entity', 'tranid', 'account','currency','exchangerate',
                    'taxtotal', 'discountamount', 'paymenthold', 'duedate',
                    'trandate', 'postingperiod', 'memo', 'custbody_me_po_number_body', 'approvalstatus',
                    'subsidiary', 'class', 'department', 'location', 'custbody_cseg_cn_cfi',
                    'custbody_me_pr_number', 'custbody_me_project_location', 'custbody_me_saving_type',
                    'custbody_me_pr_date', 'custbody_me_pr_type', 'lastmodifieddate'
                ]
            });

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
            let foundBillIds   = [];

            searchPage.data.forEach(res => {
                foundBillIds.push(res.id);
                pagedHeaders.push({
                    bill_id:                      res.id,
                    transactionnumber:            res.getValue('transactionnumber'),
                    entity:                       res.getValue('entity'),
                    entity_display:               res.getText('entity'),
                    tranid:                       res.getValue('tranid'),
                    account:                      res.getValue('account'),
                    account_display:              res.getText('account'),
                    currency:                     res.getValue('currency'),
                    currency_display:             res.getText('currency'),
                    exchangerate:                 res.getValue('exchangerate'),
                    taxtotal:                     Math.abs(res.getValue('taxtotal') || 0),
                    discountamount:               res.getValue('discountamount'),
                    paymenthold:                  res.getValue('paymenthold'),
                    duedate:                      formatToISO(res.getValue('duedate')),
                    trandate:                     formatToISO(res.getValue('trandate')),
                    last_modified:                formatToISO(res.getValue('lastmodifieddate')),
                    postingperiod:                res.getValue('postingperiod'),
                    postingperiod_display:        res.getText('postingperiod'),
                    memo:                         res.getValue('memo'),
                    custbody_me_po_number_body:   res.getValue('custbody_me_po_number_body'),
                    approvalstatus:               res.getValue('approvalstatus'),
                    approvalstatus_display:       res.getText('approvalstatus'),
                    subsidiary:                   res.getValue('subsidiary'),
                    subsidiary_display:           res.getText('subsidiary'),
                    class:                        res.getValue('class'),
                    class_display:                res.getText('class'),
                    department:                   res.getValue('department'),
                    department_display:           res.getText('department'),
                    location:                     res.getValue('location'),
                    location_display:             res.getText('location'),
                    custbody_cseg_cn_cfi:         res.getValue('custbody_cseg_cn_cfi'),
                    custbody_me_pr_number:        res.getValue('custbody_me_pr_number'),
                    custbody_me_project_location: res.getValue('custbody_me_project_location'),
                    custbody_me_saving_type:      res.getValue('custbody_me_saving_type'),
                    custbody_me_pr_date:          formatToISO(res.getValue('custbody_me_pr_date')),
                    custbody_me_pr_type:          res.getValue('custbody_me_pr_type'),
                    expenses: [],
                    items: [],
                    workflow_history: [],
                    user_notes: []
                });
            });

            // Search Line Items & Expenses
            let linesByBill = {};
            if (foundBillIds.length > 0) {
                let lineSearch = search.create({
                    type: search.Type.VENDOR_BILL,
                    filters: [
                        ['internalid', 'anyof', foundBillIds],
                        'AND',
                        ['mainline', 'is', 'F'],
                        'AND',
                        ['taxline', 'is', 'F']
                    ],
                    columns: [
                        'internalid', 'line', 'lineuniquekey', 'item', 'expensecategory', 'account', 'amount',
                        'taxcode', 'taxamount', 'memo', 'department', 'class', 'location',
                        'entity', 'custcol_4601_witaxapplies', 'custcol_4601_witaxcode',
                        'custcol_4601_witaxrate', 'custcol_4601_witaxbaseamount', 'custcol_4601_witaxamount',
                        'quantity', 'unit', 'rate', 'grossamount', 'options', 'custcol_me_landed_cost'
                    ]
                });

                lineSearch.run().each(res => {
                    let billId = res.getValue('internalid');
                    if (!linesByBill[billId]) linesByBill[billId] = { expenses: [], items: [] };

                    let itemId = res.getValue('item');
                    let lineObj = {
                        line_id:                    res.getValue('lineuniquekey'),
                        line:                       res.getValue('line'),
                        account:                    res.getValue('account'),
                        account_display:            res.getText('account'),
                        amount:                     Math.abs(res.getValue('amount') || 0),
                        taxcode:                    res.getValue('taxcode'),
                        taxcode_display:            res.getText('taxcode'),
                        taxrate:                    res.getValue('taxrate'),
                        taxamt:                     Math.abs(res.getValue('taxamount') || 0),
                        grossamt:                   (Math.abs(res.getValue('grossamount')) || (Math.abs(res.getValue('amount') || 0) + Math.abs(res.getValue('taxamount') || 0))),
                        memo:                       res.getValue('memo'),
                        department:                 res.getValue('department'),
                        department_display:         res.getText('department'),
                        class:                      res.getValue('class'),
                        class_display:              res.getText('class'),
                        location:                   res.getValue('location'),
                        location_display:           res.getText('location'),
                        customer:                   res.getValue('entity'),
                        customer_display:           res.getText('entity'),
                        apply_wh_tax:               res.getValue('custcol_4601_witaxapplies'),
                        wh_tax_code:                res.getValue('custcol_4601_witaxcode'),
                        wh_tax_rate:                res.getValue('custcol_4601_witaxrate'),
                        wh_tax_base_amount:         res.getValue('custcol_4601_witaxbaseamount'),
                        wh_tax_amount:              res.getValue('custcol_4601_witaxamount')
                    };

                    if (itemId) {
                        // It is an Item
                        lineObj.item = itemId;
                        lineObj.item_display = res.getText('item');
                        lineObj.quantity = res.getValue('quantity');
                        lineObj.units = res.getValue('unit');
                        lineObj.units_display = res.getText('unit');
                        lineObj.description = res.getValue('memo');
                        lineObj.rate = res.getValue('rate');
                        lineObj.options = res.getValue('options');
                        lineObj.landed_cost = res.getValue('custcol_me_landed_cost');
                        
                        linesByBill[billId].items.push(lineObj);
                    } else {
                        // It is an Expense
                        lineObj.category = res.getValue('expensecategory');
                        lineObj.category_display = res.getText('expensecategory');
                        
                        linesByBill[billId].expenses.push(lineObj);
                    }

                    return true;
                });
            }

            // Search Workflow History
            // Note: 'workflowactioninstance' tidak tersedia di semua environment NetSuite (mis. sandbox)
            let workflowByBill = {};
            if (foundBillIds.length > 0) {
                try {
                    let wfSearch = search.create({
                        type: 'workflowactioninstance',
                        filters: [
                            ['recordid', 'anyof', foundBillIds],
                            'AND',
                            ['recordtype', 'is', 'vendorbill']
                        ],
                        columns: [
                            search.createColumn({ name: 'date', sort: search.Sort.ASC }),
                            'recordid',
                            'workflowid',
                            'operator',
                            'date',
                            'actionid',
                            'substitutefrom',
                            'substituteto',
                            'delegateto',
                            'comment'
                        ]
                    });

                    wfSearch.run().each(res => {
                        let billId = res.getValue('recordid');
                        if (!workflowByBill[billId]) workflowByBill[billId] = [];

                        workflowByBill[billId].push({
                            approval_record:         res.getValue('workflowid'),
                            approval_record_display: res.getText('workflowid'),
                            user_changed:            res.getValue('operator'),
                            user_changed_display:    res.getText('operator'),
                            date_created:            formatToISO(res.getValue('date')),
                            action:                  res.getValue('actionid'),
                            action_display:          res.getText('actionid'),
                            substitute_from:         res.getValue('substitutefrom'),
                            substitute_from_display: res.getText('substitutefrom'),
                            substitute_to:           res.getValue('substituteto'),
                            substitute_to_display:   res.getText('substituteto'),
                            delegate_to:             res.getValue('delegateto'),
                            delegate_to_display:     res.getText('delegateto'),
                            notes_message:           res.getValue('comment')
                        });

                        return true;
                    });
                } catch (wfErr) {
                    // workflowactioninstance tidak support di environment ini, workflow_history akan kosong
                }
            }

            // Search User Notes
            let notesByBill = {};
            if (foundBillIds.length > 0) {
                let noteSearch = search.create({
                    type: 'note',
                    filters: [
                        search.createFilter({
                            name:     'internalid',
                            join:     'transaction',
                            operator: search.Operator.ANYOF,
                            values:   foundBillIds
                        })
                    ],
                    columns: [
                        'internalid',
                        search.createColumn({ name: 'notedate', sort: search.Sort.ASC }),
                        search.createColumn({ name: 'internalid', join: 'transaction' }),
                        'notedate',
                        'author',
                        'title',
                        'note',
                        'direction',
                        'notetype'
                    ]
                });

                let processedNoteIds = {};
                noteSearch.run().each(res => {
                    let noteRecordId = res.id;
                    if (processedNoteIds[noteRecordId]) return true;
                    processedNoteIds[noteRecordId] = true;

                    let billId = res.getValue({ name: 'internalid', join: 'transaction' });
                    if (!notesByBill[billId]) notesByBill[billId] = [];

                    notesByBill[billId].push({
                        date:              formatToISO(res.getValue('notedate')),
                        author:            res.getValue('author'),
                        author_display:    res.getText('author'),
                        title:             res.getValue('title'),
                        memo:              res.getValue('note'),
                        direction:         res.getValue('direction'),
                        direction_display: res.getText('direction'),
                        type:              res.getValue('notetype'),
                        type_display:      res.getText('notetype')
                    });

                    return true;
                });
            }

            let data = pagedHeaders.map(header => {
                if (linesByBill[header.bill_id]) {
                    header.expenses = linesByBill[header.bill_id].expenses || [];
                    header.items = linesByBill[header.bill_id].items || [];
                }
                header.workflow_history = workflowByBill[header.bill_id] || [];
                header.user_notes = notesByBill[header.bill_id] || [];
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
