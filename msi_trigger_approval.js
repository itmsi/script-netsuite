/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define(['N/record', 'N/runtime'], function(record, runtime) {

    function post(context) {

        try {

            var recId = context.id;
            var recordType = context.recordType;

            if (!recId || !recordType) {
                return {
                    success: false,
                    message: "recordType and id are required"
                };
            }

            // mapping type
            var recordTypeMap = {
                purchaseorder: record.Type.PURCHASE_ORDER,
                salesorder: record.Type.SALES_ORDER,
                invoice: record.Type.INVOICE
            };

            var nsRecordType = recordTypeMap[recordType.toLowerCase()] || recordType;

            var noteId = null;

            // ==============================
            // CREATE NOTE (FIRST)
            // ==============================
            if (context.note && context.note.trim() !== "") {

                var noteRec = record.create({
                    type: 'note',
                    isDynamic: true
                });

                noteRec.setValue({
                    fieldId: 'title',
                    value: context.noteTitle || 'API Note'
                });

                noteRec.setValue({
                    fieldId: 'note',
                    value: context.note
                });

                noteRec.setValue({
                    fieldId: 'transaction',
                    value: recId 
                });

                noteRec.setValue({
                    fieldId: 'author',
                    value: runtime.getCurrentUser().id
                });

                noteId = noteRec.save();

                log.debug("Note Created First", noteId);
            }

            // ==============================
            // LOAD RECORD
            // ==============================
            var rec = record.load({
                type: nsRecordType,
                id: recId,
                isDynamic: false
            });

            // ==============================
            // UPDATE FLAGS
            // ==============================
            if (context.custbody_msi_submit_app_api !== undefined) {
                rec.setValue({
                    fieldId: 'custbody_msi_submit_app_api',
                    value: context.custbody_msi_submit_app_api
                });
            }

            if (context.custbody_msi_reopen_api !== undefined) {
                rec.setValue({
                    fieldId: 'custbody_msi_reopen_api',
                    value: context.custbody_msi_reopen_api
                });
            }

            if (context.custbody_msi_resubmit_api !== undefined) {
                rec.setValue({
                    fieldId: 'custbody_msi_resubmit_api',
                    value: context.custbody_msi_resubmit_api
                });
            }

            // ==============================
            // SAVE (TRIGGER WORKFLOW)
            // ==============================
            var savedId = rec.save({
                enableSourcing: true,
                ignoreMandatoryFields: true
            });

            return {
                success: true,
                message: "Note created first, record updated & workflow triggered",
                data: {
                    id: savedId,
                    noteId: noteId
                }
            };

        } catch (e) {

            log.error("ERROR", e);

            return {
                success: false,
                message: e.message
            };
        }
    }

    return {
        post: post
    };

});