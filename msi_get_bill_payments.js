/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET list Vendor Payment menggunakan method POST dengan search
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
     "payment_ids":        {number[]} - Filter berdasarkan internal ID vendor payment (array)
     "tranid":             {string}   - Filter berdasarkan Payment Number (tranid)
     "transactionnumber":  {string}   - Filter berdasarkan Transaction Number
     "vendor_id":          {number}   - Filter berdasarkan internal ID vendor (entity)
     "lastmodified":       {string}   - Filter tanggal diubah (opsional, cth: "2026-03-31T23:59:00+07:00")
   }
 }
 */

define(['N/search', 'N/record'], (search, record) => {

    const formatToISO = (dateStr) => {
        if (!dateStr) return null;

        // Jika value sudah berupa object Date (karena record.getSublistValue mengembalikan Date, bukan string)
        if (dateStr instanceof Date) {
            var year = dateStr.getFullYear();
            var month = String(dateStr.getMonth() + 1).padStart(2, '0');
            var day = String(dateStr.getDate()).padStart(2, '0');
            var hour = String(dateStr.getHours()).padStart(2, '0');
            var minute = String(dateStr.getMinutes()).padStart(2, '0');
            var second = String(dateStr.getSeconds()).padStart(2, '0');
            return `${year}-${month}-${day}T${hour}:${minute}:${second}+07:00`;
        }

        if (typeof dateStr !== 'string') {
            dateStr = String(dateStr);
        }

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

    const getVal = (rec, sublist, field, line) => {
        try {
            return rec.getSublistValue({ sublistId: sublist, fieldId: field, line: line });
        } catch(e) {
            return null;
        }
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
                ['type', 'anyof', 'VendPymt'],
                'AND',
                ['mainline', 'is', 'T']
            ];

            if (filtersBody.payment_ids && Array.isArray(filtersBody.payment_ids) && filtersBody.payment_ids.length > 0) {
                searchFilters.push('AND', ['internalid', 'anyof', filtersBody.payment_ids]);
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
                type: search.Type.VENDOR_PAYMENT,
                filters: searchFilters,
                columns: [
                    search.createColumn({ name: sortBy, sort: sortOrder ? search.Sort.DESC : search.Sort.ASC }),
                    'internalid',
                    'transactionnumber', 'entity', 'account', 'total', 
                    'currency', 'exchangerate', 'trandate', 'postingperiod', 'tranid',
                    'custbody_me_wf_created_by', 'approvalstatus', 'subsidiary', 'department',
                    'class', 'location', 'custbody_cseg_cn_cfi', 'lastmodifieddate'
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
            let foundPaymentIds = [];

            searchPage.data.forEach(res => {
                foundPaymentIds.push(res.id);
                pagedHeaders.push({
                    payment_id:                        res.id,
                    transactionnumber:                 res.getValue('transactionnumber'),
                    entity:                            res.getValue('entity'),
                    entity_display:                    res.getText('entity'),
                    account:                           res.getValue('account'),
                    account_display:                   res.getText('account'),
                    total:                             res.getValue('total'),
                    currency:                          res.getValue('currency'),
                    currency_display:                  res.getText('currency'),
                    exchangerate:                      res.getValue('exchangerate'),
                    trandate:                          formatToISO(res.getValue('trandate')),
                    postingperiod:                     res.getValue('postingperiod'),
                    postingperiod_display:             res.getText('postingperiod'),
                    tranid:                            res.getValue('tranid'),
                    custbody_me_wf_created_by:         res.getValue('custbody_me_wf_created_by'),
                    custbody_me_wf_created_by_display: res.getText('custbody_me_wf_created_by'),
                    approvalstatus:                    res.getValue('approvalstatus'),
                    approvalstatus_display:            res.getText('approvalstatus'),
                    subsidiary:                        res.getValue('subsidiary'),
                    subsidiary_display:                res.getText('subsidiary'),
                    department:                        res.getValue('department'),
                    department_display:                res.getText('department'),
                    class:                             res.getValue('class'),
                    class_display:                     res.getText('class'),
                    location:                          res.getValue('location'),
                    location_display:                  res.getText('location'),
                    custbody_cseg_cn_cfi:              res.getValue('custbody_cseg_cn_cfi'),
                    custbody_cseg_cn_cfi_display:      res.getText('custbody_cseg_cn_cfi'),
                    last_modified:                     formatToISO(res.getValue('lastmodifieddate')),
                    applied_to:                        [],
                    credit_applied:                    [],
                    workflow_history:                  [],
                    user_notes:                        []
                });
            });

            // Load records to get sublists 'apply' and 'credit'
            // Menggunakan record.load karena NetSuite search untuk lines apply & credit pada Vendor Payment 
            // sangat sulit dipetakan secara akurat tanpa field-field UI khusus.
            pagedHeaders.forEach(header => {
                try {
                    let rec = record.load({ type: record.Type.VENDOR_PAYMENT, id: header.payment_id });
                    
                    // sublist 'apply' -> Applied To (Bills)
                    try {
                        let applyCount = rec.getLineCount({ sublistId: 'apply' });
                        header.debug_apply_count = applyCount; // see how many lines exist
                        
                        for (let i = 0; i < applyCount; i++) {
                            // Hanya ambil yang applied (amount > 0 atau apply = T)
                            let isApplied = getVal(rec, 'apply', 'apply', i);
                            let amountStr = getVal(rec, 'apply', 'amount', i);
                            let amount = parseFloat(amountStr) || 0;
                            
                            if (isApplied === true || isApplied === 'T' || amount > 0) {
                                let applyObj = {
                                    apply_id:           getVal(rec, 'apply', 'doc', i),
                                    date_due:           formatToISO(getVal(rec, 'apply', 'duedate', i)),
                                    type:               getVal(rec, 'apply', 'type', i),
                                    ref_no:             getVal(rec, 'apply', 'refnum', i),
                                    installment_ref_no: getVal(rec, 'apply', 'installment', i),
                                    orig_amt:           getVal(rec, 'apply', 'total', i),
                                    amt_due:            getVal(rec, 'apply', 'due', i),
                                    currency:           getVal(rec, 'apply', 'currency', i),
                                    disc_date:          formatToISO(getVal(rec, 'apply', 'discdate', i)),
                                    disc_avail:         getVal(rec, 'apply', 'discamt', i),
                                    disc_taken:         getVal(rec, 'apply', 'disc', i),
                                    payment:            amountStr
                                };
                                header.applied_to.push(applyObj);
                            }
                        }
                    } catch (e) {
                        header.error_apply_sublist = e.message;
                    }

                    // sublist 'credit' -> Credit Applied (Vendor Credits)
                    try {
                        let creditCount = rec.getLineCount({ sublistId: 'credit' });
                        header.debug_credit_count = creditCount; // see how many lines exist

                        for (let i = 0; i < creditCount; i++) {
                            let isApplied = getVal(rec, 'credit', 'apply', i);
                            let amountStr = getVal(rec, 'credit', 'amount', i);
                            let amount = parseFloat(amountStr) || 0;

                            if (isApplied === true || isApplied === 'T' || amount > 0) {
                                let dateVal = getVal(rec, 'credit', 'docdate', i) || getVal(rec, 'credit', 'applydate', i);
                                let creditObj = {
                                    credit_id:  getVal(rec, 'credit', 'doc', i),
                                    date:       formatToISO(dateVal),
                                    type:       getVal(rec, 'credit', 'type', i),
                                    ref_no:     getVal(rec, 'credit', 'refnum', i),
                                    applied_to: getVal(rec, 'credit', 'appliedto', i),
                                    currency:   getVal(rec, 'credit', 'currency', i),
                                    payment:    amountStr
                                };
                                header.credit_applied.push(creditObj);
                            }
                        }
                    } catch (e) {
                        header.error_credit_sublist = e.message;
                    }
                } catch (recErr) {
                    header.error_loading_lines = recErr.message;
                }
            });

            // Fallback Search: Jika credit sublist tidak bisa diload (-1) pada Vendor Payment existing,
            // kita cari Vendor Credit yang diaplikasikan ke Bill yang sedang dibayar oleh Payment ini.
            let allPaidBillIds = [];
            pagedHeaders.forEach(h => {
                h.applied_to.forEach(app => {
                    if (app.apply_id) allPaidBillIds.push(app.apply_id);
                });
            });

            if (allPaidBillIds.length > 0) {
                try {
                    let creditSearch = search.create({
                        type: search.Type.VENDOR_BILL,
                        filters: [
                            ['internalid', 'anyof', allPaidBillIds],
                            'AND',
                            ['mainline', 'is', 'T']
                        ],
                        columns: [
                            'internalid', // Bill ID
                            search.createColumn({ name: 'internalid', join: 'applyingtransaction' }),
                            search.createColumn({ name: 'trandate', join: 'applyingtransaction' }),
                            search.createColumn({ name: 'type', join: 'applyingtransaction' }),
                            search.createColumn({ name: 'tranid', join: 'applyingtransaction' }),
                            search.createColumn({ name: 'currency', join: 'applyingtransaction' }),
                            search.createColumn({ name: 'amount', join: 'applyingtransaction' }),
                            search.createColumn({ name: 'fxamount', join: 'applyingtransaction' }),
                            'applyinglinkamount'
                        ]
                    });

                    let creditMapByBill = {};
                    let searchCount = 0;
                    creditSearch.run().each(res => {
                        let applyingType = res.getValue({ name: 'type', join: 'applyingtransaction' });
                        
                        // Hanya proses jika yang apply adalah Vendor Credit
                        if (applyingType === 'VendCred') {
                            searchCount++;
                            let billId = res.getValue('internalid');
                            if (!creditMapByBill[billId]) creditMapByBill[billId] = [];

                            let linkAmount = Math.abs(parseFloat(res.getValue('applyinglinkamount')) || 0);
                            let fallbackAmount = Math.abs(parseFloat(res.getValue({ name: 'amount', join: 'applyingtransaction' })) || 0);
                            let foreignAmount = Math.abs(parseFloat(res.getValue({ name: 'fxamount', join: 'applyingtransaction' })) || 0);
                            
                            // Prioritaskan foreign amount jika ada, lalu fallback ke link amount atau amount base
                            let amt = foreignAmount > 0 ? foreignAmount : (linkAmount > 0 ? linkAmount : fallbackAmount);
                            
                            // Jika foreign amount = 0, tetapi kita tau kursnya (misal dari bill), 
                            // NetSuite search terkadang 'applyinglinkamount' berupa base currency.
                            // Di sini foreignAmount dari Vendor Credit header akan pas 24000.
                            
                            creditMapByBill[billId].push({
                                credit_id:  res.getValue({ name: 'internalid', join: 'applyingtransaction' }),
                                date:       formatToISO(res.getValue({ name: 'trandate', join: 'applyingtransaction' })),
                                type:       res.getText({ name: 'type', join: 'applyingtransaction' }) || applyingType || 'Bill Credit',
                                ref_no:     res.getValue({ name: 'tranid', join: 'applyingtransaction' }),
                                applied_to: 'Bill',
                                currency:   res.getText({ name: 'currency', join: 'applyingtransaction' }) || res.getValue({ name: 'currency', join: 'applyingtransaction' }),
                                payment:    amt
                            });
                        }
                        return true;
                    });

                    // Masukkan ke masing-masing header payment
                    pagedHeaders.forEach(h => {
                        h.debug_paid_bill_ids = allPaidBillIds;
                        h.debug_credit_search_count = searchCount;
                        if (h.debug_credit_count === -1 || h.credit_applied.length === 0) {
                            let creditsForThisPayment = [];
                            h.applied_to.forEach(app => {
                                if (app.apply_id && creditMapByBill[app.apply_id]) {
                                    creditMapByBill[app.apply_id].forEach(cred => {
                                        // Cegah duplikasi jika 1 credit dipakai di >1 bill pada payment yg sama
                                        if (!creditsForThisPayment.some(c => c.credit_id === cred.credit_id)) {
                                            creditsForThisPayment.push(cred);
                                        }
                                    });
                                }
                            });
                            h.credit_applied = creditsForThisPayment;
                        }
                    });
                } catch (credSearchErr) {
                    pagedHeaders.forEach(h => { h.error_credit_search = credSearchErr.message; });
                }
            }

            // Search Workflow History (Menggunakan System Notes)
            let workflowByDoc = {};
            if (foundPaymentIds.length > 0) {
                try {
                    let sysNoteSearch = search.create({
                        type: search.Type.TRANSACTION,
                        filters: [
                            ['internalid', 'anyof', foundPaymentIds],
                            'AND',
                            ['mainline', 'is', 'T'],
                            'AND',
                            ['systemnotes.date', 'isnotempty', '']
                        ],
                        columns: [
                            'internalid',
                            search.createColumn({ name: 'date', join: 'systemnotes', sort: search.Sort.ASC }),
                            search.createColumn({ name: 'name', join: 'systemnotes' }),
                            search.createColumn({ name: 'field', join: 'systemnotes' }),
                            search.createColumn({ name: 'oldvalue', join: 'systemnotes' }),
                            search.createColumn({ name: 'newvalue', join: 'systemnotes' })
                        ]
                    });

                    sysNoteSearch.run().each(res => {
                        let docId = res.getValue('internalid');
                        if (!workflowByDoc[docId]) workflowByDoc[docId] = [];

                        workflowByDoc[docId].push({
                            date_created:  formatToISO(res.getValue({ name: 'date', join: 'systemnotes' })),
                            user_changed:  res.getValue({ name: 'name', join: 'systemnotes' }),
                            user_display:  res.getText({ name: 'name', join: 'systemnotes' }) || res.getValue({ name: 'name', join: 'systemnotes' }),
                            field:         res.getValue({ name: 'field', join: 'systemnotes' }),
                            field_display: res.getText({ name: 'field', join: 'systemnotes' }) || res.getValue({ name: 'field', join: 'systemnotes' }),
                            old_value:     res.getValue({ name: 'oldvalue', join: 'systemnotes' }),
                            new_value:     res.getValue({ name: 'newvalue', join: 'systemnotes' })
                        });

                        return true;
                    });
                } catch (wfErr) {
                    // Abaikan jika error
                }
            }

            // Search User Notes
            let notesByDoc = {};
            if (foundPaymentIds.length > 0) {
                try {
                    let noteSearch = search.create({
                        type: 'note',
                        filters: [
                            search.createFilter({
                                name:     'internalid',
                                join:     'transaction',
                                operator: search.Operator.ANYOF,
                                values:   foundPaymentIds
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

                        let docId = res.getValue({ name: 'internalid', join: 'transaction' });
                        if (!notesByDoc[docId]) notesByDoc[docId] = [];

                        notesByDoc[docId].push({
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
                } catch (noteErr) {
                    // Abaikan jika error
                }
            }

            let data = pagedHeaders.map(header => {
                header.workflow_history = workflowByDoc[header.payment_id] || [];
                header.user_notes = notesByDoc[header.payment_id] || [];
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
