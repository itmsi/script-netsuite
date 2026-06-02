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

define(['N/search', 'N/record', 'N/query'], (search, record, query) => {

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

        // 3. FORMAT: YYYY-MM-DD HH:mm:ss (dari NetSuite formula)
        var yyyyRegex = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/;
        var m3 = dateStr.match(yyyyRegex);
        if (m3) {
            return `${m3[1]}-${m3[2]}-${m3[3]}T${m3[4]}:${m3[5]}:${m3[6]}+07:00`;
        }

        // 4. FALLBACK
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
                    'currency', 'exchangerate', 'trandate', 'postingperiod', 'tranid', search.createColumn({ name: 'balance', join: 'vendor' }),
                    'custbody_me_wf_created_by', 'approvalstatus', 'subsidiarynohierarchy', 'department',
                    search.createColumn({ name: 'custworkflow_me_wf_current_approver', join: 'workflow' }), 
                    'custbody_me_wf_next_approver_blank', 'custbody_me_delegate_approver', 'custbody_me_wf_in_delegation',
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
                    balance:                           res.getValue({ name: 'balance', join: 'vendor' }),
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
                    next_approver:                     res.getValue('custworkflow_me_wf_current_approver'),
                    delegate_approver:                 res.getValue('custbody_me_delegate_approver'),
                    in_delegation:                     res.getValue('custbody_me_wf_in_delegation'),
                    next_approver_blank:               res.getValue('custbody_me_wf_next_approver_blank'),
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

            // ── Workflow History via Transaction Search Join ────────────────────────
            let workflowByDoc = {};
            if (foundPaymentIds.length > 0) {
                try {
                    let wfSearch = search.create({
                        type: search.Type.VENDOR_PAYMENT,
                        filters: [
                            ['internalid', 'anyof', foundPaymentIds],
                            'AND',
                            ['mainline', 'is', 'T']
                        ],
                        columns: [
                            search.createColumn({ name: 'internalid' }),
                            search.createColumn({ name: 'workflow', join: 'workflowHistory' }),
                            search.createColumn({ name: 'options', join: 'workflowHistory' }),
                            search.createColumn({ name: 'notes', join: 'workflowHistory' }),
                            search.createColumn({ name: 'formulatext', formula: '{workflowhistory.dateenteredstate}', sort: search.Sort.DESC }),
                            search.createColumn({ name: 'formulatext', formula: '{workflowhistory.dateexitedstate}' })
                        ]
                    });

                    let pagedData = wfSearch.runPaged({ pageSize: 1000 });

                    pagedData.pageRanges.forEach(function(pageRange) {
                        let page = pagedData.fetch({ index: pageRange.index });
                        page.data.forEach(function(res) {
                            let docId = res.getValue('internalid');
                            let workflowType = res.getText({ name: 'workflow', join: 'workflowHistory' });
                            
                            if (workflowType) {
                                // parse NetSuite raw options string into an object
                                let rawOptions = res.getValue({ name: 'options', join: 'workflowHistory' }) || '';
                                let parsedOptions = {};
                                
                                if (rawOptions) {
                                    // Hilangkan tanda + agar consecutive delimiters tidak di-merge menjadi satu, sehingga string kosong tetap terbaca
                                    let parts = rawOptions.split(/[\x00-\x1F]/);
                                    let i = 0;
                                    let isFieldId = (str) => str && ((str.toUpperCase() === str && str.includes('_')) || str.toLowerCase().startsWith('cust'));
                                    
                                    while (i < parts.length) {
                                        let p = parts[i];
                                        if (!p) {
                                            i++;
                                            continue;
                                        }
                                        
                                        if (isFieldId(p)) {
                                            let typeInd = parts[i + 1];
                                            let label = parts[i + 2];
                                            let internalVal = parts[i + 3];
                                            let displayVal = parts[i + 4];
                                            
                                            if (typeInd && typeInd.length === 1 && label) {
                                                if (isFieldId(displayVal) || displayVal === undefined) {
                                                    parsedOptions[label] = internalVal || '';
                                                    i += 4;
                                                } else {
                                                    parsedOptions[label] = displayVal;
                                                    parsedOptions[label + ' Id'] = internalVal || '';
                                                    i += 5;
                                                }
                                                continue;
                                            }
                                        }
                                        i++;
                                    }
                                }

                                if (!workflowByDoc[docId]) workflowByDoc[docId] = [];
                                workflowByDoc[docId].push({
                                    workflow:     workflowType,
                                    date_entered: formatToISO(res.getValue({ name: 'formulatext', formula: '{workflowhistory.dateenteredstate}' })),
                                    date_exited:  formatToISO(res.getValue({ name: 'formulatext', formula: '{workflowhistory.dateexitedstate}' })),
                                    options_obj:  parsedOptions,
                                    options:      rawOptions.replace(/[\x00-\x1F]/g, ' | '),
                                    notes:        res.getValue({ name: 'notes', join: 'workflowHistory' })
                                });
                            }
                        });
                    });
                } catch (wfErr) {
                    pagedHeaders.forEach(h => {
                        h.workflow_history_error = {
                            name:    wfErr.name    || 'UnknownError',
                            message: wfErr.message || String(wfErr),
                            stack:   wfErr.stack   || null
                        };
                    });
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
                let wfHist = workflowByDoc[header.payment_id] || [];
                
                // Sorting logic:
                // 1. "Is Final?": "Yes" ditaruh paling atas
                // 2. Jika sama, urutkan berdasarkan date_entered descending (terbaru ke terlama)
                wfHist.sort((a, b) => {
                    let aIsFinal = (a.options_obj && a.options_obj['Is Final?'] === 'Yes') ? 1 : 0;
                    let bIsFinal = (b.options_obj && b.options_obj['Is Final?'] === 'Yes') ? 1 : 0;
                    
                    if (aIsFinal !== bIsFinal) {
                        return bIsFinal - aIsFinal;
                    }
                    
                    let timeA = a.date_entered ? new Date(a.date_entered).getTime() : 0;
                    let timeB = b.date_entered ? new Date(b.date_entered).getTime() : 0;
                    
                    return timeB - timeA;
                });
                
                header.workflow_history = wfHist;
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
