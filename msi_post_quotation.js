/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * RESTlet script untuk membuat (Create) atau mengupdate (Update) Quotation (Estimate).
 * Smart Update: Update baris item jika itemId sama, tambah jika baru, hapus baris yang tidak ada di payload.
 *
 * Menggunakan isDynamic: false agar field seperti location/department/class
 * bisa di-set tanpa terkena field-change event validation dari NetSuite.
 *
 * === CONTOH PAYLOAD (POST BODY) ===
{
  "id": 1001,                              // Opsional: Isi Internal ID Estimate jika ingin UPDATE. Kosongkan jika CREATE.
  "customform": 114,                       // Internal ID custom form (opsional)
  "entity": 1052,                          // Internal ID Customer (wajib untuk CREATE)
  "subsidiary": 5,                         // Internal ID Subsidiary
  "trandate": "20/3/2026",                 // Tanggal Transaksi
  "title": "Judul Quotation",              // Judul (custom field)
  "memo": "Catatan Quotation",
  "otherrefnum": "PO-001",                 // Nomor Referensi Lain
  "department": 101,                       // Internal ID Department
  "class": 3,                              // Internal ID Class
  "location": 19,                          // Internal ID Location
  "currency": 1,                           // Internal ID Currency
  "duedate": "30/3/2026",                  // Tanggal Jatuh Tempo
  "probability": 80,                       // Probabilitas (%)
  "expectedclosedate": "30/3/2026",        // Perkiraan Tanggal Close
  "salesrep": 101,                         // Internal ID Sales Rep
  "opportunity": 201,                      // Internal ID Opportunity
  "forecasttype": 1,                       // Internal ID Forecast Type
  "partner": 301,                          // Internal ID Partner
  "custbody_msi_bank_payment_so": [3, 5],  // Multi-select custom field
  "custbody_cseg_cn_cfi": 4,               // Custom field
  "custbody_me_approval_status": 2,        // 1 = Pending Approval, 2 = Approved, 3 = Rejected
  "items": [
    {
      "itemId": 19593,                     // Internal ID item (wajib)
      "qty": 5,                            // Quantity
      "rate": 1500000,                     // Harga satuan
      "amount": 7500000,                   // Total Amount
      "description": "Deskripsi item",     // Deskripsi (memo)
      "department": 101,
      "class": 3,
      "location": 19,
      "taxcode": 18098,                    // Internal ID tax code
      "pricelevel": 1,                     // Internal ID price level
      "unit": "pcs"                        // Unit
    }
  ]
}
 */
define(['N/record', 'N/format', 'N/log', 'N/search'], (record, format, log, search) => {

    /**
     * Helper: set sublist field hanya jika value ada
     */
    const setLine = (est, line, fieldId, value) => {
        if (value === undefined || value === null || value === '') return;
        est.setSublistValue({ sublistId: 'item', fieldId, line, value });
    };

    /**
     * POST handler - Create or Update Quotation (Estimate)
     * isDynamic: false → tidak ada field-change event, bebas set field dalam urutan apapun.
     */
    const post = (context) => {
        try {
            let estimate;
            const files = context.files;
            const isUpdate = !!context.id;

            // ═══════════════════════════════════════════════════════════════
            //  LOAD or CREATE  (isDynamic: false)
            // ═══════════════════════════════════════════════════════════════
            if (isUpdate) {
                estimate = record.load({
                    type: record.Type.ESTIMATE,
                    id: context.id,
                    isDynamic: false
                });
            } else {
                estimate = record.create({
                    type: record.Type.ESTIMATE,
                    isDynamic: false
                });
            }

            // ═══════════════════════════════════════════════════════════════
            //  HEADER FIELDS
            //  isDynamic:false → setValue bebas urutan, tanpa field-change event
            // ═══════════════════════════════════════════════════════════════

            const setVal = (fieldId, value) => {
                if (value === undefined || value === null || value === '') return;
                estimate.setValue({ fieldId, value });
            };

            // customform HANYA di-set saat CREATE.
            // Pada UPDATE: mengubah customform me-lock field entity → error.
            if (!isUpdate && context.customform) {
                estimate.setValue({ fieldId: 'customform', value: context.customform });
            }

            // entity & subsidiary HANYA di-set saat CREATE.
            // Pada UPDATE: field ini sudah ada di record yang di-load.
            // Memanggil setValue untuk entity/subsidiary pada existing record
            // menyebabkan NetSuite mendeteksi "perubahan" yang ditolak saat save.
            if (!isUpdate) {
                setVal('entity', context.entity);
                setVal('subsidiary', context.subsidiary);
            }

            setVal('currency', context.currency);

            // Segment fields — aman di-set di non-dynamic mode
            setVal('location', context.location);
            setVal('department', context.department);
            setVal('class', context['class']);

            if (context.trandate) {
                setVal('trandate', format.parse({ value: context.trandate, type: format.Type.DATE }));
            }
            if (context.duedate) {
                setVal('duedate', format.parse({ value: context.duedate, type: format.Type.DATE }));
            }
            if (context.expectedclosedate) {
                setVal('expectedclosedate', format.parse({ value: context.expectedclosedate, type: format.Type.DATE }));
            }

            setVal('title', context.title);
            setVal('memo', context.memo);
            setVal('otherrefnum', context.otherrefnum);
            setVal('salesrep', context.salesrep);
            setVal('opportunity', context.opportunity);
            setVal('forecasttype', context.forecasttype);
            setVal('partner', context.partner);

            if (context.probability !== undefined && context.probability !== null) {
                estimate.setValue({ fieldId: 'probability', value: context.probability });
            }

            // ── Custom Fields ──────────────────────────────────────────────
            if (context.custbody_msi_bank_payment_so !== undefined && context.custbody_msi_bank_payment_so !== null) {
                const val = Array.isArray(context.custbody_msi_bank_payment_so)
                    ? context.custbody_msi_bank_payment_so
                    : [context.custbody_msi_bank_payment_so];
                estimate.setValue({ fieldId: 'custbody_msi_bank_payment_so', value: val });
            }
            setVal('custbody_cseg_cn_cfi', context.custbody_cseg_cn_cfi);
            if (context.custbody_me_approval_status !== undefined && context.custbody_me_approval_status !== null) {
                estimate.setValue({ fieldId: 'custbody_me_approval_status', value: context.custbody_me_approval_status });
            }

            // ═══════════════════════════════════════════════════════════════
            //  LINE ITEMS  (non-dynamic: pakai setSublistValue + line index)
            // ═══════════════════════════════════════════════════════════════
            if (context.items && Array.isArray(context.items)) {

                // Baca baris yang sudah ada (untuk smart update)
                const existingLineCount = estimate.getLineCount({ sublistId: 'item' });
                const existingItems = [];
                for (let i = 0; i < existingLineCount; i++) {
                    existingItems.push({
                        index: i,
                        item: estimate.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }),
                        processed: false
                    });
                }

                // Kumpulkan line index yang akan digunakan per payload item
                const lineAssignments = []; // { payloadItem, lineIndex, isNew }

                context.items.forEach((payloadItem) => {
                    const targetItemId = payloadItem.itemId || payloadItem.item;
                    let matchIndex = -1;

                    if (isUpdate && targetItemId) {
                        for (let j = 0; j < existingItems.length; j++) {
                            if (!existingItems[j].processed && String(existingItems[j].item) === String(targetItemId)) {
                                matchIndex = existingItems[j].index;
                                existingItems[j].processed = true;
                                break;
                            }
                        }
                    }

                    lineAssignments.push({ payloadItem, lineIndex: matchIndex, isNew: matchIndex === -1 });
                });

                // Hapus baris yang tidak ada di payload (dari belakang agar index tidak bergeser)
                if (isUpdate) {
                    for (let k = existingItems.length - 1; k >= 0; k--) {
                        if (!existingItems[k].processed) {
                            try {
                                estimate.removeLine({ sublistId: 'item', line: existingItems[k].index });
                            } catch (e) {
                                log.error('Failed to remove line at index ' + existingItems[k].index, e);
                            }
                        }
                    }
                }

                // Set nilai per baris — existing line pakai index lama, new line pakai getLineCount()
                lineAssignments.forEach(({ payloadItem, lineIndex, isNew }) => {
                    const targetItemId = payloadItem.itemId || payloadItem.item;
                    const line = isNew ? estimate.getLineCount({ sublistId: 'item' }) : lineIndex;

                    if (targetItemId) {
                        setLine(estimate, line, 'item', targetItemId);
                    }

                    const qty = payloadItem.qty || payloadItem.quantity;
                    if (qty !== undefined && qty !== null) {
                        setLine(estimate, line, 'quantity', qty);
                    }
                    if (payloadItem.rate !== undefined && payloadItem.rate !== null) {
                        setLine(estimate, line, 'rate', payloadItem.rate);
                    }
                    if (payloadItem.amount !== undefined && payloadItem.amount !== null) {
                        setLine(estimate, line, 'amount', payloadItem.amount);
                    }

                    setLine(estimate, line, 'description', payloadItem.description);
                    setLine(estimate, line, 'department', payloadItem.department);
                    setLine(estimate, line, 'class', payloadItem['class']);
                    setLine(estimate, line, 'location', payloadItem.location);
                    setLine(estimate, line, 'taxcode', payloadItem.taxcode);
                    setLine(estimate, line, 'pricelevel', payloadItem.pricelevel);
                    setLine(estimate, line, 'unit', payloadItem.unit);
                });
            }

            // ═══════════════════════════════════════════════════════════════
            //  SAVE & RETURN
            // ═══════════════════════════════════════════════════════════════
            const estimateId = estimate.save();

            // =========================
            // ATTACH MULTIPLE FILE (URL)
            // =========================
            if (context.id) {
                const recFileSearch = search.create({
                    type: 'customrecord_msi_web_url_file',
                    filters: [
                        ['custrecord_msi_transaction_id', 'is', context.id],
                        'AND',
                        ['isinactive', 'is', 'F']
                    ],
                    columns: ['internalid']
                });

                recFileSearch.run().each((result) => {
                    const recId = result.getValue('internalid');

                    log.debug("fileid", recId);

                    record.submitFields({
                        type: 'customrecord_msi_web_url_file',
                        id: recId,
                        values: {
                            isinactive: true
                        },
                        options: {
                            enableSourcing: false,
                            ignoreMandatoryFields: true
                        }
                    });

                    return true;
                });
            }

            const resultfileid = [];
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const recFile = record.create({
                        type: 'customrecord_msi_web_url_file',
                        isDynamic: true
                    });

                    recFile.setValue({
                        fieldId: 'custrecord_msi_web_related_transaction',
                        value: estimateId
                    });

                    recFile.setValue({
                        fieldId: 'custrecord_msi_transaction_id',
                        value: estimateId
                    });

                    recFile.setValue({
                        fieldId: 'name',
                        value: files[i].fileName
                    });

                    recFile.setValue({
                        fieldId: 'custrecord_msi_web_url',
                        value: files[i].fileUrl
                    });

                    recFile.setValue({
                        fieldId: 'custrecord_msi_createdby_api_file',
                        value: context.custbody_msi_createdby_api
                    });

                    const idFile = recFile.save();
                    resultfileid.push({
                        success: true,
                        idFile: idFile,
                        index: i
                    });
                }
            }

            const savedRecord = record.load({
                type: record.Type.ESTIMATE,
                id: estimateId,
                isDynamic: false
            });

            return {
                status: 'success',
                id: estimateId,
                tranid: savedRecord.getValue('tranid'),
                message: 'Quotation ' + (isUpdate ? 'updated' : 'created') + ' successfully',
                resultfile: resultfileid
            };

        } catch (e) {
            log.error('Error processing quotation', e);
            return {
                status: 'error',
                message: e.message,
                code: e.code || 'UNKNOWN_ERROR'
            };
        }
    };

    return { post };
});
