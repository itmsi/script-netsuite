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
        * Created Date  : 16/03/2026 13:47:09
        * Last Modified : 16/03/2026 13:47:09
        * Function      : beforeLoad
        * Purpose       : load print invoice button in SI transaction
        * Params
        */

        function beforeLoad(context) {
            var curr = context.newRecord;
            try {
                var currentForm = context.form;

                if (context.type == "view") {
                    const href = url.resolveScript({
                         scriptId: 'customscript_msi_si_invoice_script',
                        deploymentId: 'customdeploy_msi_si_invoice_deploy',
                        params: {
                          recId: curr.id
                          //recordId: curr.id, recordType: curr.type
                        },
                    });

                    var printButton = currentForm.addButton({
                        id: 'custpage_print_invoice',
                        label: '🖨 Print Invoice',
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