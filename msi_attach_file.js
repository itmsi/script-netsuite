/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MSI – Attach File CRUD
 * Custom Record: customrecord_msi_web_url_file
 *
 * Endpoint ini mengelola file attachment (URL-based) yang terhubung ke
 * transaksi NetSuite apa pun (PO, SO, TO, Item Receipt, dll.) via netsuite_id.
 *
 * ┌─────────┬──────────────────────────────────────────────────────────────────┐
 * │ Method  │ Payload / Kegunaan                                               │
 * ├─────────┼──────────────────────────────────────────────────────────────────┤
 * │ GET     │ Ambil semua file berdasarkan netsuite_id (query param)           │
 * │ POST    │ Tambah file baru ke netsuite_id                                  │
 * │ PUT     │ Update file (fileName / fileUrl) berdasarkan file record id      │
 * │ DELETE  │ Soft-delete (isinactive=true) berdasarkan file record id         │
 * └─────────┴──────────────────────────────────────────────────────────────────┘
 *
 * ── GET ──────────────────────────────────────────────────────────────────────
 * Query params  : ?netsuite_id=5157
 * Response      :
 * {
 *   "success": true,
 *   "netsuite_id": "5157",
 *   "total": 2,
 *   "files": [
 *     { "id": 101, "fileName": "Invoice.pdf", "fileUrl": "https://...", "created_by_api": "..." }
 *   ]
 * }
 *
 * ── POST ─────────────────────────────────────────────────────────────────────
 * Body:
 * {
 *   "netsuite_id"    : 5157,
 *   "created_by_api" : "user@mail.com",
 *   "files": [
 *     { "fileName": "Invoice.pdf", "fileUrl": "https://..." },
 *     { "fileName": "PO.pdf",      "fileUrl": "https://..." }
 *   ]
 * }
 *
 * ── PUT ──────────────────────────────────────────────────────────────────────
 * Body:
 * {
 *   "id"       : 101,
 *   "fileName" : "NewName.pdf",
 *   "fileUrl"  : "https://..."
 * }
 *
 * ── DELETE ───────────────────────────────────────────────────────────────────
 * Body:
 * {
 *   "id" : 101
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

define(['N/record', 'N/search', 'N/log'], function (record, search, log) {

    // ─── Konstanta Custom Record ─────────────────────────────────────────────
    var CUSTOM_RECORD_TYPE   = 'customrecord_msi_web_url_file';
    var FIELD_TRANSACTION_ID = 'custrecord_msi_transaction_id';        // Free-Form Text
    var FIELD_RELATED_TX     = 'custrecord_msi_web_related_transaction'; // List/Record (link)
    var FIELD_NAME           = 'name';
    var FIELD_URL            = 'custrecord_msi_web_url';
    var FIELD_CREATED_BY     = 'custrecord_msi_createdby_api_file';

    // ─── Helper: fetch semua hasil search (mengatasi batas 1000 baris) ───────
    function fetchAllResults(searchObj, callback) {
        var pageSize = 1000;
        var start    = 0;
        var results  = searchObj.run();

        var keepGoing = true;
        while (keepGoing) {
            var slice = results.getRange({ start: start, end: start + pageSize });
            if (!slice || slice.length === 0) break;

            for (var i = 0; i < slice.length; i++) {
                var cont = callback(slice[i]);
                if (cont === false) { keepGoing = false; break; }
            }

            if (slice.length < pageSize) break;
            start += pageSize;
        }
    }

    // =========================================================================
    // GET – Ambil file berdasarkan netsuite_id
    // URL: .../restlet?script=xxx&deploy=xxx&netsuite_id=5157
    // =========================================================================
    function get(requestParams) {
        try {
            var netsuiteId = requestParams.netsuite_id;
            if (!netsuiteId) {
                return { success: false, error: 'Parameter netsuite_id wajib diisi.' };
            }

            var fileSearch = search.create({
                type: CUSTOM_RECORD_TYPE,
                filters: [
                    [FIELD_TRANSACTION_ID, 'is', String(netsuiteId)],
                    'AND',
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    'internalid',
                    FIELD_NAME,
                    FIELD_TRANSACTION_ID,
                    FIELD_URL,
                    FIELD_CREATED_BY
                ]
            });

            var files        = [];
            var processedIds = {};

            fetchAllResults(fileSearch, function (result) {
                var recId = result.id;
                if (processedIds[recId]) return true;
                processedIds[recId] = true;

                files.push({
                    id             : parseInt(recId, 10),
                    fileName       : result.getValue(FIELD_NAME),
                    fileUrl        : result.getValue(FIELD_URL),
                    created_by_api : result.getValue(FIELD_CREATED_BY)
                });
                return true;
            });

            return {
                success     : true,
                netsuite_id : netsuiteId,
                total       : files.length,
                files       : files
            };

        } catch (e) {
            log.error('GET Attach File Error', e.message);
            return { success: false, error: e.message };
        }
    }

    // =========================================================================
    // POST – Tambah satu atau banyak file ke netsuite_id
    // =========================================================================
    function post(context) {
        try {
            var netsuiteId = context.netsuite_id;
            var files      = context.files;
            var createdBy  = context.created_by_api || '';

            if (!netsuiteId) {
                return { success: false, error: 'Field netsuite_id wajib diisi.' };
            }
            if (!files || !Array.isArray(files) || files.length === 0) {
                return { success: false, error: 'Field files (array) wajib diisi dan tidak boleh kosong.' };
            }

            var resultFileIds = [];

            for (var i = 0; i < files.length; i++) {
                var fileItem = files[i];

                if (!fileItem.fileName || !fileItem.fileUrl) {
                    resultFileIds.push({
                        success : false,
                        index   : i,
                        error   : 'fileName dan fileUrl wajib diisi pada setiap item.'
                    });
                    continue;
                }

                try {
                    var recFile = record.create({
                        type      : CUSTOM_RECORD_TYPE,
                        isDynamic : true
                    });

                    recFile.setValue({ fieldId: FIELD_RELATED_TX,     value: netsuiteId });
                    recFile.setValue({ fieldId: FIELD_TRANSACTION_ID, value: String(netsuiteId) });
                    recFile.setValue({ fieldId: FIELD_NAME,           value: fileItem.fileName });
                    recFile.setValue({ fieldId: FIELD_URL,            value: fileItem.fileUrl });
                    recFile.setValue({ fieldId: FIELD_CREATED_BY,     value: createdBy });

                    var savedId = recFile.save();

                    resultFileIds.push({
                        success  : true,
                        id       : savedId,
                        index    : i,
                        fileName : fileItem.fileName
                    });

                } catch (innerErr) {
                    log.error('POST Attach File – item error', 'index=' + i + ' | ' + innerErr.message);
                    resultFileIds.push({
                        success : false,
                        index   : i,
                        error   : innerErr.message
                    });
                }
            }

            var allSuccess = resultFileIds.every(function (r) { return r.success; });

            return {
                success     : allSuccess,
                netsuite_id : netsuiteId,
                results     : resultFileIds
            };

        } catch (e) {
            log.error('POST Attach File Error', e.message);
            return { success: false, error: e.message };
        }
    }

    // =========================================================================
    // PUT – Update fileName dan/atau fileUrl berdasarkan file record id
    // =========================================================================
    function put(context) {
        try {
            var fileRecordId = context.id;

            if (!fileRecordId) {
                return { success: false, error: 'Field id (internal ID file record) wajib diisi.' };
            }
            if (!context.fileName && !context.fileUrl) {
                return { success: false, error: 'Minimal satu dari fileName atau fileUrl harus diisi.' };
            }

            var fieldsToUpdate = {};
            if (context.fileName) fieldsToUpdate[FIELD_NAME] = context.fileName;
            if (context.fileUrl)  fieldsToUpdate[FIELD_URL]  = context.fileUrl;

            record.submitFields({
                type    : CUSTOM_RECORD_TYPE,
                id      : fileRecordId,
                values  : fieldsToUpdate,
                options : {
                    enableSourcing       : false,
                    ignoreMandatoryFields: true
                }
            });

            log.audit('PUT Attach File', 'Updated file id=' + fileRecordId);

            return {
                success : true,
                id      : fileRecordId,
                updated : fieldsToUpdate
            };

        } catch (e) {
            log.error('PUT Attach File Error', e.message);
            return { success: false, error: e.message };
        }
    }

    // =========================================================================
    // DELETE – Soft-delete (isinactive = true) berdasarkan file record id
    // =========================================================================
    function doDelete(context) {
        try {
            var fileRecordId = context.id;

            if (!fileRecordId) {
                return { success: false, error: 'Field id (internal ID file record) wajib diisi.' };
            }

            record.submitFields({
                type    : CUSTOM_RECORD_TYPE,
                id      : fileRecordId,
                values  : { isinactive: true },
                options : {
                    enableSourcing       : false,
                    ignoreMandatoryFields: true
                }
            });

            log.audit('DELETE Attach File', 'Soft-deleted file id=' + fileRecordId);

            return {
                success : true,
                id      : fileRecordId,
                message : 'File berhasil di-nonaktifkan (soft delete).'
            };

        } catch (e) {
            log.error('DELETE Attach File Error', e.message);
            return { success: false, error: e.message };
        }
    }

    // ─── Export handler sesuai HTTP method ──────────────────────────────────
    return {
        get    : get,
        post   : post,
        put    : put,
        'delete': doDelete
    };

});
