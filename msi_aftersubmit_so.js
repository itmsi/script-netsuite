/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */

define([], function () {

    function beforeSubmit(context) {

        var rec = context.newRecord;

        if (context.type === context.UserEventType.CREATE) {

            rec.setValue({
                fieldId: 'orderstatus',
                value: 'B'
            });

        }

    }

    return {
        beforeSubmit: beforeSubmit
    };

});