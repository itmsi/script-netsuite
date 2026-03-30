/**
* @NApiVersion 2.1
* @NScriptType UserEventScript
* @NModuleScope SameAccount
* Created by: Dharma Ridwan
*/
define(['N/record', 'N/ui/serverWidget', 'N/url'],

    function (record, serverWidget, url) {
        /**
        * Author        : Dharma Ridwan
        * Created Date  : 01/03/2026 13:47:09
        * Last Modified : 01/03/2026 13:47:09
        * Function      : beforeLoad
        * Purpose       : load print booking fee button in SO transaction
        * Params
        */

        function beforeLoad(context) {
            var curr = context.newRecord;
            try {
                var currentForm = context.form;

                if (context.type == "view") {
                    const href = url.resolveScript({
                        scriptId: 'customscript_msi_so_pi_bookingfee_script',
                        deploymentId: 'customdeploy_msi_so_pi_bookingfee_deploy',
                        params: {
                            recId: curr.id
                            //recordId: curr.id, recordType: curr.type
                        },
                    });

                    // document.location = suiteletURL;

                    var printButton = currentForm.addButton({
                        id: 'custpage_print_booking_fee',
                        label: '🖨 Print Booking Fee',                 
                        functionName: "window.open('" + href + "','_blank')"
                    });
                }

            } catch (error) {
                log.debug("error", error);
                throw "Something Error " + error;
            }
        }

        return {
            beforeLoad: beforeLoad
        };

    });