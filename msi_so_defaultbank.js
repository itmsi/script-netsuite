/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */

define(['N/currentRecord'], function(currentRecord) {

    function pageInit(context) {

        if (context.mode === 'create') {

            var rec = currentRecord.get();

            rec.setValue({
                fieldId: 'custbody_msi_bank_payment_so',
                value: ['1','3'] // isi dengan internal ID Bank
            });

        }
    }

    return {
        pageInit: pageInit
    };

});