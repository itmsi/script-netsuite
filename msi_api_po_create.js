/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 */
define(['N/record','N/format'], function (record, format) {

    function post(context) {

        try {
            log.debug('Payload', context);
            var po = record.create({
                type: record.Type.PURCHASE_ORDER,
                isDynamic: true
            });

            // ===== HEADER =====
            po.setValue({
                fieldId: 'customform', 
                value: context.customform
            });
          
            po.setValue({
                fieldId: 'entity', // Vendor Internal ID
                value: context.vendorid
            });

            if (context.purchasedate) {
                var purchaseDateObj = format.parse({
                  value: context.purchasedate,
                  type: format.Type.DATE
                });

                po.setValue({
                    fieldId: 'trandate',
                    value: purchaseDateObj
                });
            }
            
            if (context.subsidiary) {
                po.setValue({
                    fieldId: 'subsidiary',
                    value: context.subsidiary
                });
            }

            if (context.location) {
                po.setValue({
                    fieldId: 'location',
                    value: context.location
                });
            }

            if (context.memo) {
                po.setValue({
                    fieldId: 'memo',
                    value: context.memo
                });
            }

            if (context.currency) {
                po.setValue({
                    fieldId: 'currency',
                    value: context.currency
                });
            }
          
            if (context.terms) {
                po.setValue({
                    fieldId: 'terms',
                    value: context.terms
                });
            }

            if (context.custbody_me_pr_date) {
                var custbody_me_pr_dateObj = format.parse({
                  value: context.custbody_me_pr_date,
                  type: format.Type.DATE
                });

                po.setValue({
                    fieldId: 'custbody_me_pr_date',
                    value: custbody_me_pr_dateObj
                });
            }

            if (context.custbody_me_project_location) {
                po.setValue({
                    fieldId: 'custbody_me_project_location',
                    value: context.custbody_me_project_location
                });
            }

            if (context.custbody_me_pr_type) {
                po.setValue({
                    fieldId: 'custbody_me_pr_type',
                    value: context.custbody_me_pr_type
                });
            }

            if (context.custbody_me_saving_type) {
                po.setValue({
                    fieldId: 'custbody_me_saving_type',
                    value: context.custbody_me_saving_type
                });
            }

            if (context.custbody_me_pr_number) {
                po.setValue({
                    fieldId: 'custbody_me_pr_number',
                    value: context.custbody_me_pr_number
                });
            }

            po.setValue({
                fieldId: 'custbody_msi_createdby_api',
                value: context.custbody_msi_createdby_api
            });

            po.setValue({
                fieldId: 'class',
                value: context.class
            });

            po.setValue({
                fieldId: 'department',
                value: context.department
            });
          
            // ===== ITEMS =====
            context.items.forEach(function (item) {

                po.selectNewLine({ sublistId: 'item' });

                po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    value: item.itemId
                });

                po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    value: item.qty
                });

                po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'rate',
                    value: item.rate
                });

                po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'department',
                    value: item.department
                });

               po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'class',
                    value: item.class
                });

                po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'location',
                    value: item.location
                });

                 po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'taxcode',
                    value: item.taxcode
                });

                po.commitLine({ sublistId: 'item' });
            });

            var poId = po.save();
            return {
                success: true,
                poId: poId
            };

        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }
    }

    return {
        post: post
    };
});