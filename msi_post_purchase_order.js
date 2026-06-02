/**
 * @NApiVersion 2.x
 * @NScriptType Restlet
 */
define(['N/record','N/format','N/search'], function (record, format, search) {

    function post(context) {
        var files = context.files;
        try {            
          if (context.id) {
                po = record.load({
                    type: record.Type.PURCHASE_ORDER,
                    id: context.id,
                    isDynamic: true
                });

                po.setValue({
                   fieldId: 'customform', 
                   value: context.customform
                });

                if (context.subsidiary) {
                   po.setValue({
                      fieldId: 'subsidiary',
                      value: context.subsidiary
                   });
                }
          
                po.setValue({
                    fieldId: 'entity', // Vendor Internal ID
                    value: context.vendorid
                });
            } 
          else {
                po = record.create({
                    type: record.Type.PURCHASE_ORDER,
                    isDynamic: true
                });

                po.setValue({
                   fieldId: 'customform', 
                   value: context.customform
                });

                po.setValue({
                    fieldId: 'entity', // Vendor Internal ID
                    value: context.vendorid
                });
            
                if (context.subsidiary) {
                   po.setValue({
                      fieldId: 'subsidiary',
                      value: context.subsidiary
                   });
                }
            }

            // ===== HEADER =====
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

           
            if (context.custbody_me_validity_date) {
                var custbody_me_validity_dateObj = format.parse({
                  value: context.custbody_me_validity_date,
                  type: format.Type.DATE
                });

                po.setValue({
                    fieldId: 'custbody_me_validity_date',
                    value: custbody_me_validity_dateObj
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

            if (context.items && context.items.length > 0) {
                if (context.id) {
                    var lineCount = po.getLineCount({ sublistId: 'item' });

                    for (var i = lineCount - 1; i >= 0; i--) {
                        po.removeLine({
                            sublistId: 'item',
                            line: i
                        });
                    }
                } 
            }
          
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
                    fieldId: 'description',
                    value: item.description
                });

                po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_msi_fob',
                    value: item.custcol_msi_fob
                });

                po.setCurrentSublistValue({
                    sublistId: 'item',
                    fieldId: 'custcol_me_landed_cost',
                    value: item.custcol_me_landed_cost
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

/// =========================
// ATTACH MULTIPLE FILE (URL)
// =========================
if (context.id) {    
        var recFileSearch = search.create({
            type: 'customrecord_msi_web_url_file',
            filters: [
               ['custrecord_msi_transaction_id', 'is', context.id],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: ['internalid']
        });
  
  recFileSearch.run().each(function(result) {
    var recId = result.getValue('internalid');

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
          
var resultfileid = [];
if (files && files.length > 0) {
    for (var i = 0; i < files.length; i++) {
      var recFile = record.create({
          type: 'customrecord_msi_web_url_file',
          isDynamic: true
      });
      
      recFile.setValue({
            fieldId: 'custrecord_msi_web_related_transaction',
            value: poId 
      });

       recFile.setValue({
            fieldId: 'custrecord_msi_transaction_id',
            value: poId 
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

      var idFile = recFile.save();
      resultfileid.push({
          success: true,
          idFile: idFile,
          index: i
      });
    }
}
          
            return {
                success: true,
                poId: poId,
                resultfile : resultfileid
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