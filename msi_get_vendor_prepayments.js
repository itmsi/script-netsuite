/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET list Vendor Prepayment menggunakan method POST dengan search
 *
 =============================================================
 REQUEST BODY PAYLOAD
 =============================================================
 *
 {
   "page":       {number}  - Halaman yang diminta (default: 1)
   "page_size":  {number}  - Jumlah record per halaman (default: 20)
   "sort_by":    {string}  - Field untuk sorting (default: "lastmodified")
   "sort_order": {string}  - Arah sorting: "ASC" | "DESC" (default: "DESC")

   "filters": {
     "id":     {number[]} - Filter berdasarkan internal ID vendor prepayment (array)
     "tranid":             {string}   - Filter berdasarkan Reference No (tranid)
     "transactionnumber":  {string}   - Filter berdasarkan Transaction Number
     "vendor_id":          {number}   - Filter berdasarkan internal ID vendor (entity)
     "debug":              {boolean}  - Sertakan applied_to_debug (jumlah baris tiap langkah Applied To)     "lastmodified":       {string}   - Filter tanggal diubah (opsional, cth: "2026-03-31T23:59:00+07:00")
   }
 }
 */

define(['N/search', 'N/record'], (search, record) => {

    const formatToISO = (dateStr) => {
        if (!dateStr) return null;

        if (dateStr instanceof Date) {
            var y  = dateStr.getFullYear();
            var mo = String(dateStr.getMonth() + 1).padStart(2, '0');
            var d  = String(dateStr.getDate()).padStart(2, '0');
            var h  = String(dateStr.getHours()).padStart(2, '0');
            var mi = String(dateStr.getMinutes()).padStart(2, '0');
            var s  = String(dateStr.getSeconds()).padStart(2, '0');
            return `${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`;
        }

        if (typeof dateStr !== 'string') dateStr = String(dateStr);

        // DD/MM/YYYY HH:mm AM/PM
        var m1 = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (m1) {
            var hour = parseInt(m1[4]);
            var ampm = m1[6].toUpperCase();
            if (ampm === 'PM' && hour !== 12) hour += 12;
            if (ampm === 'AM' && hour === 12) hour = 0;
            return `${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${m1[5]}:00+07:00`;
        }

        // DD/MM/YYYY
        var m2 = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m2) {
            return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}T00:00:00+07:00`;
        }

        // YYYY-MM-DD HH:mm:ss
        var m3 = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
        if (m3) {
            return `${m3[1]}-${m3[2]}-${m3[3]}T${m3[4]}:${m3[5]}:${m3[6]}+07:00`;
        }

        var dt = new Date(dateStr);
        if (isNaN(dt)) return dateStr;
        return dt.toISOString();
    };

    const formatAmount = (val) => {
        if (val === null || val === undefined || val === '') return null;
        let num = parseFloat(val);
        return isNaN(num) ? String(val) : num.toFixed(2);
    };

    // getRange maksimal 1000 baris per panggilan -> loop sampai habis
    const getAllRows = (searchObj) => {
        const pageSize = 1000;
        let rows = [];
        let start = 0;
        let chunk;
        do {
            chunk = searchObj.run().getRange({ start: start, end: start + pageSize });
            rows = rows.concat(chunk);
            start += pageSize;
        } while (chunk.length === pageSize);
        return rows;
    };

    const post = (body) => {
        try {
            body = body || {};

            let page      = body.page      || 1;
            let pageSize  = body.page_size || 20;
            let sortBy    = body.sort_by   || 'lastmodifieddate';
            if (sortBy === 'lastmodified') sortBy = 'lastmodifieddate';
            let sortDesc  = (body.sort_order || 'DESC').toUpperCase() !== 'ASC';

            let filtersBody = body.filters || {};

            let searchFilters = [
                ['type', 'anyof', 'VPrep'],
                'AND',
                ['mainline', 'is', 'T']
            ];

            if (Array.isArray(filtersBody.id) && filtersBody.id.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.id]);
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
                // Komponen tanggal/jam diambil apa adanya dari string ISO (asumsi WIB, +07:00),
                // formula TO_DATE dengan format mask eksplisit agar tidak bergantung locale/timezone.
                var lm = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(filtersBody.lastmodified));
                if (!lm) {
                    throw new Error("filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + filtersBody.lastmodified + "'.");
                }
                var lmSql = lm[1] + '-' + lm[2] + '-' + lm[3] + ' ' + lm[4] + ':' + lm[5] + ':' + (lm[6] || '00');
                var lmFormula = "formulanumeric: CASE WHEN {lastmodifieddate} >= TO_DATE('" + lmSql + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END";
                searchFilters.push('AND', [lmFormula, 'equalto', '1']);
            }

            let headerSearch = search.create({
                type: 'transaction',
                settings: [{ name: 'consolidationtype', value: 'ACCTTYPE' }],
                filters: searchFilters,
                columns: [
                    search.createColumn({ name: sortBy, sort: sortDesc ? search.Sort.DESC : search.Sort.ASC }),
                    'internalid',
                    'customform', 'transactionnumber', 'entity', 'account',
                    'currency', 'exchangerate', 'trandate', 'postingperiod',
                    'tranid', 'memo',
                    'approvalstatus', 'custbody_me_wf_created_by', 'custbody_me_delegate_approver',
                    'custbody_me_wf_in_delegation', 'subsidiarynohierarchy', 'department', 'class',
                    'location', 'custbody_cseg_cn_cfi', 'lastmodifieddate'
                ]
            });

            let pagedData    = headerSearch.runPaged({ pageSize: pageSize });
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
            let headers = [];
            let ids = [];

            searchPage.data.forEach(res => {
                ids.push(res.id);
                headers.push({
                    prepayment_id:                     res.id,
                    customform:                        res.getValue('customform'),
                    customform_display:                res.getText('customform'),
                    transactionnumber:                 res.getValue('transactionnumber'),
                    entity:                            res.getValue('entity'),
                    entity_display:                    res.getText('entity'),
                    purchaseorder:                     null,
                    purchaseorder_display:             null,
                    account:                           res.getValue('account'),
                    account_display:                   res.getText('account'),
                    payment:                           null,
                    currency:                          res.getValue('currency'),
                    currency_display:                  res.getText('currency'),
                    exchangerate:                      res.getValue('exchangerate'),
                    trandate:                          formatToISO(res.getValue('trandate')),
                    postingperiod:                     res.getValue('postingperiod'),
                    postingperiod_display:             res.getText('postingperiod'),
                    prepaymentaccount:                 null,
                    prepaymentaccount_display:         null,
                    tobeprinted:                       null,
                    printvoucher:                      null,
                    tranid:                            res.getValue('tranid'),
                    memo:                              res.getValue('memo'),
                    approvalstatus:                    res.getValue('approvalstatus'),
                    approvalstatus_display:            res.getText('approvalstatus'),
                    custbody_me_wf_created_by:         res.getValue('custbody_me_wf_created_by'),
                    custbody_me_wf_created_by_display: res.getText('custbody_me_wf_created_by'),
                    delegate_approver:                 res.getValue('custbody_me_delegate_approver'),
                    delegate_approver_display:         res.getText('custbody_me_delegate_approver'),
                    in_delegation:                     res.getValue('custbody_me_wf_in_delegation'),
                    next_approver_blank:               null,
                    subsidiary:                        res.getValue('subsidiarynohierarchy'),
                    subsidiary_display:                res.getText('subsidiarynohierarchy'),
                    department:                        res.getValue('department'),
                    department_display:                res.getText('department'),
                    class:                             res.getValue('class'),
                    class_display:                     res.getText('class'),
                    location:                          res.getValue('location'),
                    location_display:                  res.getText('location'),
                    custbody_cseg_cn_cfi:              res.getValue('custbody_cseg_cn_cfi'),
                    custbody_cseg_cn_cfi_display:      res.getText('custbody_cseg_cn_cfi'),
                    address:                           null,
                    last_modified:                     formatToISO(res.getValue('lastmodifieddate')),
                    applied_to:                        [],
                    applied_total:                     '0.00'
                });
            });

            // Field yang tidak tersedia sebagai kolom search (payment, prepaymentaccount, tobeprinted,
            // printvoucher, purchaseorder, address, next approver) dibaca langsung dari record.
            const safe = (rec, fn, fieldId) => {
                try { return rec[fn]({ fieldId }); } catch (e) { return null; }
            };
            headers.forEach(h => {
                try {
                    let rec = record.load({ type: 'vendorprepayment', id: h.prepayment_id });
                    h.purchaseorder             = safe(rec, 'getValue', 'purchaseorder') || null;
                    h.purchaseorder_display     = safe(rec, 'getText', 'purchaseorder') || null;
                    h.payment                   = formatAmount(safe(rec, 'getValue', 'payment'));
                    h.prepaymentaccount         = safe(rec, 'getValue', 'prepaymentaccount') || null;
                    h.prepaymentaccount_display = safe(rec, 'getText', 'prepaymentaccount') || null;
                    h.tobeprinted               = safe(rec, 'getValue', 'tobeprinted');
                    h.printvoucher              = safe(rec, 'getValue', 'printvoucher');
                    h.address                   = safe(rec, 'getValue', 'address') || null;
                    h.next_approver_blank = rec.getValue({ fieldId: 'custbody_me_wf_next_approver_blank' }) || null;
                    h.next_approver_blank_display = rec.getText({ fieldId: 'custbody_me_wf_next_approver_blank' }) || null;
                } catch (e) {
                    h.error_loading_record = e.message;
                }
            });

            // ── Applied To: Date Applied, Type, Number, Date, Original Amount, Applied Amount ──
            // Link apply ada di baris non-mainline prepayment (applyingtransaction = VPrepApp).
            // Transaksi yang dibayar (Bill, dll) adalah transaksi lain yang applyingtransaction-nya
            // juga VPrepApp yang sama; applyinglinkamount di sisi Bill = Applied Amount.
            let appliedByDoc = {};
            let dbg = {};
            try {
                // Step 1: VPrepApp milik tiap prepayment
                let appByPrepay = {};   // prepayment id -> [{ id, date }]
                let appIds = [];
                let linkSearch = search.create({
                    type: 'transaction',
                    filters: [['internalid', 'anyof', ids]],
                    columns: [
                        'internalid',
                        'applyingtransaction',
                        search.createColumn({ name: 'type', join: 'applyingtransaction' }),
                        search.createColumn({ name: 'trandate', join: 'applyingtransaction' })
                    ]
                });
                let linkRows = getAllRows(linkSearch);
                dbg.link_rows = linkRows.length;
                [linkRows].forEach(rows => {
                    rows.forEach(res => {
                        let appId = res.getValue('applyingtransaction');
                        let appType = res.getValue({ name: 'type', join: 'applyingtransaction' });
                        if (filtersBody.debug) (dbg.link_sample = dbg.link_sample || []).push({ appId, appType });
                        if (!appId || (appType && appType !== 'VPrepApp')) return;
                        let pid = res.getValue('internalid');
                        if (!appByPrepay[pid]) appByPrepay[pid] = [];
                        if (appByPrepay[pid].some(a => a.id === appId)) return;
                        appByPrepay[pid].push({ id: appId, date: res.getValue({ name: 'trandate', join: 'applyingtransaction' }) });
                        appIds.push(appId);
                        dbg.app_ids = appIds;
                    });
                });

                // Step 2: transaksi yang di-apply oleh VPrepApp tersebut
                if (appIds.length > 0) {
                    let vendorIds = headers.map(h => h.entity).filter((v, i, a) => v && a.indexOf(v) === i);
                    let targetsByApp = {};
                    let targetSearch = search.create({
                        type: 'transaction',
                        filters: [
                            ['type', 'anyof', 'VendBill'],
                            'AND',
                            ['mainline', 'is', 'T'],
                            'AND',
                            ['entity', 'anyof', vendorIds],
                            'AND',
                            ['applyingtransaction.internalid', 'noneof', '@NONE@']
                        ],
                        columns: [
                            'internalid', 'type', 'tranid', 'transactionnumber', 'trandate', 'fxamount',
                            'applyinglinkamount',
                            search.createColumn({ name: 'internalid', join: 'applyingtransaction' }),
                            search.createColumn({ name: 'trandate', join: 'applyingtransaction' })
                        ]
                    });
                    let targetRows = getAllRows(targetSearch);
                    dbg.target_rows = targetRows.length;
                    dbg.target_sample = targetRows.slice(0, 10).map(r => ({ id: r.id, applying: r.getValue({ name: 'internalid', join: 'applyingtransaction' }) }));
                    [targetRows].forEach(rows => {
                        rows.forEach(res => {
                            let appId = res.getValue({ name: 'internalid', join: 'applyingtransaction' });
                            if (appIds.indexOf(appId) === -1) return; // Bill ini juga di-apply transaksi lain
                            if (!targetsByApp[appId]) targetsByApp[appId] = [];
                            targetsByApp[appId].push({
                                applied_id:      res.id,
                                applying_date:   res.getValue({ name: 'trandate', join: 'applyingtransaction' }),
                                type:            res.getText('type'),
                                number:          res.getValue('tranid'),
                                transaction_number: res.getValue('transactionnumber'),
                                date:            formatToISO(res.getValue('trandate')),
                                original_amount: formatAmount(Math.abs(parseFloat(res.getValue('fxamount')) || 0)),
                                applied_amount:  formatAmount(Math.abs(parseFloat(res.getValue('applyinglinkamount')) || 0))
                            });
                        });
                    });

                    Object.keys(appByPrepay).forEach(pid => {
                        appliedByDoc[pid] = [];
                        appByPrepay[pid].forEach(app => {
                            (targetsByApp[app.id] || []).forEach(t => {
                                let { applying_date, ...rest } = t;
                                appliedByDoc[pid].push(Object.assign({
                                    application_id: app.id,
                                    date_applied:   formatToISO(app.date || applying_date)
                                }, rest));
                            });
                        });
                    });
                }
            } catch (appErr) {
                headers.forEach(h => { h.applied_to_error = appErr.message; });
            }
            if (filtersBody.debug) headers.forEach(h => { h.applied_to_debug = dbg; });

            let data = headers.map(h => {
                h.applied_to = appliedByDoc[h.prepayment_id] || [];
                h.applied_total = formatAmount(h.applied_to.reduce((s, a) => s + (parseFloat(a.applied_amount) || 0), 0));
                return h;
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
