/**
 * @NApiVersion 2.x
 * @NScriptType ClientScript
 */

define(['N/currentRecord'], function(currentRecord) {

function fieldChanged(context) {

    if (context.sublistId !== 'item') return;

    // Trigger hanya dari field tertentu
    if (
        context.fieldId !== 'custcol_msi_down_payment_percent' &&
        context.fieldId !== 'amount' &&
        context.fieldId !== 'quantity' &&
        context.fieldId !== 'custcol_msi_booking_fee_so'
    ) return;

    var rec = currentRecord.get();

    var amount = parseFloat(rec.getCurrentSublistValue({
        sublistId: 'item',
        fieldId: 'amount'
    })) || 0;

    var dpPercent = parseFloat(rec.getCurrentSublistValue({
        sublistId: 'item',
        fieldId: 'custcol_msi_down_payment_percent'
    })) || 0;

    var bookingfee = parseFloat(rec.getCurrentSublistValue({
        sublistId: 'item',
        fieldId: 'custcol_msi_booking_fee_so'
    })) || 0;

    var quantity = parseFloat(rec.getCurrentSublistValue({
        sublistId: 'item',
        fieldId: 'quantity'
    })) || 0;
    
    if (dpPercent > 0) {

        var dpAmount = (amount * (dpPercent / 100)) - (bookingfee * quantity);
        rec.setCurrentSublistValue({
            sublistId: 'item',
            fieldId: 'custcol_msi_down_payment_amount',
            value: dpAmount,
            ignoreFieldChange: true
        });
    }
}

return {
    fieldChanged: fieldChanged
};

});