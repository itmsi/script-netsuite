/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define(['N/record', 'N/runtime', 'N/workflow'], function(record, runtime, workflow) {

    function post(context) {

        try {

            var recId = context.id;
            var recordType = context.recordType;
			var recordActionId = context.actionId;
            var recordNextApproval = context.custbody_me_wf_next_approver_blank;
			
			if (!recId || !recordType || !recordActionId) {
                return {
                    success: false,
                    message: "recordType and id and actionId are required"
                };
            }
			
			// mapping type
            var recordTypeMap = {
                purchaseorder: record.Type.PURCHASE_ORDER,
                salesorder: record.Type.SALES_ORDER,
                invoice: record.Type.INVOICE,
				vendorpayment: record.Type.VENDOR_PAYMENT
            };
			
			var actionIdMap = {
               approve: 'workflowaction_me_pa_btn_apr',
               reject: 'workflowaction_me_pa_btn_rej',
               delegate_approve: 'workflowaction_me_dl_btn_apr',
               delegate_reject: 'workflowaction_me_dl_btn_rej'
			};
			
			var nsRecordType = recordTypeMap[recordType.toLowerCase()] || recordType;
			var actionId = actionIdMap[recordActionId.toLowerCase()] || recordActionId;
            var noteId = null;
            // ==============================
            // Validate Next Approval
            // ==============================
            var rec = record.load({
                type: nsRecordType,
                id: recId,
                isDynamic: false
            });
			
			var next_approval_id = rec.getValue("custbody_me_wf_next_approver_blank");
            log.debug("next_approval_id", next_approval_id);
          log.debug("recordNextApproval", recordNextApproval);
			if(recordNextApproval != next_approval_id)
			{
			  return {
                    success: false,
                    message: "Approval tidak sama",
                    data: {
                        next_approval_id_submit: recordNextApproval,
                        next_approval_id_oracle: next_approval_id
                    }
                };
			}
      
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
            // UPDATE WORKFLOW
            // ==============================
			try {
                var recType = nsRecordType;

                workflow.trigger({
                    recordId: recId,
                    recordType: recType,
                    workflowId: 'customworkflow_me_workflow_approvals_dl',
                    actionId: actionId
                });

                try {
                    record.load({ type: recType, id: recId, isDynamic: false });
                } catch (loadErr) {
                    log.error({
                        title: 'Submit Approval - gagal force record.load setelah trigger',
                        details: 'trxId ' + recId + ': ' + loadErr.message
                    });
                }
            } catch (e) {
                log.error({title: 'Submit Approval error', details: 'trxId ' + recId + ': ' + e.message});
				return {
                    success: false,
                    message: "Workflow gagal di-trigger: " + e.message,
                    data: {
                        id: recId,
                        noteId: noteId
                    }
                };
            }
			
            return {
                success: true,
                message: "Note created first, record updated & workflow triggered",
                data: {
                    id: recId,
                    noteId: noteId,
                    action: actionId
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