/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */

define(['N/render','N/search','../MSI/lib/msi_lib_util'], function(render, search, utilLib) {
function onRequest(context){

var recId = context.request.parameters.recId;

/* ==============================
   GET SALES INVOICE HEADER
============================== */
var siData = {
    subsidiary : "",
    tranid : "",
    trandate : "",
    companyname : "",
    billaddress : "",
    items : [],
    totalQty : 0,
    subTotalAmount : 0,
    taxTotalAmount : 0,
    totalPayment : 0,
    soNumber : "",
    fulfillmentNumbers  : "",
    memo : ""
};
  
var siSearch = search.create({
    type: search.Type.INVOICE,
    filters:[
        ["internalid","anyof",recId],
        "AND",
        ["mainline","is","T"]
    ],
    columns:[
        "tranid",
        "trandate",
        "subsidiary",
        "billaddress",
        "createdfrom",
        "memo",
        "custbody_msi_bank_payment_so",
        search.createColumn({
            name:"tranid",
            join:"createdFrom"
        }),
        search.createColumn({
            name:"companyname",
            join:"customer"
        })
    ]
});

var soHeader = siSearch.run().getRange({start:0,end:1})[0];

siData.tranid = soHeader.getValue("tranid");
siData.trandate = soHeader.getValue("trandate");
siData.subsidiary = soHeader.getText("subsidiary");
siData.billaddress = soHeader.getValue("billaddress");
siData.memo = soHeader.getValue("memo");
siData.companyname = soHeader.getValue({
    name:"companyname",
    join:"customer"
});
var soId = soHeader.getValue("createdfrom");
siData.soNumber = soHeader.getValue({
    name: "tranid",
    join: "createdFrom"
});
  
/* ==============================
   GET ITEM LINES
============================== */
var totalAmountLine = 0;
var totalQtyLine = 0;
var totalTaxAmountLine = 0;

var lineSearch = search.create({
    type: search.Type.INVOICE,
    filters:[
        ["internalid","anyof",recId],
        "AND",
        ["mainline","is","F"],
        "AND",
        ["taxline", "is", "F"],
        "AND",
        ["shipping", "is", "F"]
    ],
    columns:[
        "line",
        "item",
        "rate",
        "amount",
        "taxamount",
        "quantity",
        "custcol_msi_down_payment_percent",
        search.createColumn({
            name:"inventorynumber",
            join:"inventoryDetail"
        })
    ]
});

var itemsMap = {};
lineSearch.run().each(function(result){
  var lineKey = result.getValue("line");
  if(!itemsMap[lineKey]){
        itemsMap[lineKey] = {
            item : result.getText("item"),
            quantity : result.getValue("quantity"),
            rate : utilLib.formatRupiah(result.getValue("rate")),
            amount : utilLib.formatRupiah(result.getValue("amount")),
            taxamount : utilLib.formatRupiah(result.getValue("taxamount")),
            serialnumbers : []
        };
        totalQtyLine += parseFloat(result.getValue("quantity")) || 0;
        totalAmountLine += parseFloat(result.getValue("amount")) || 0; 
        totalTaxAmountLine += parseFloat(result.getValue("taxamount")) || 0;
    }

    var lotNumber = result.getText({
        name:"inventorynumber",
        join:"inventoryDetail"
    });

    if(lotNumber){
        itemsMap[lineKey].serialnumbers.push(lotNumber);
    }
    return true;
});

for(var key in itemsMap){
    siData.items.push(itemsMap[key]);
}

siData.totalQty = totalQtyLine;
siData.subTotalAmount = utilLib.formatRupiah(totalAmountLine);
siData.taxTotalAmount = utilLib.formatRupiah(totalTaxAmountLine);
  
/* ==============================
   SEARCH ITEM FULFILLMENT
============================== */

var fulfillmentNumbers = [];

if(soId){
 var fulfillSearch = search.create({
    type: "itemfulfillment",
    filters:[
        ["createdfrom","anyof",soId],
        "AND",
        ["mainline","is","T"]
    ],
    columns:[
        "tranid"
    ]
});

fulfillSearch.run().each(function(result){

    fulfillmentNumbers.push(result.getValue("tranid"));

    return true;
});

}

siData.fulfillmentNumbers = fulfillmentNumbers.join(", ");

/* ==============================
   SEARCH BANK
============================== */
var bankIdsStr = soHeader.getValue("custbody_msi_bank_payment_so");
var bankIds = [];
if (bankIdsStr) {
    bankIds = bankIdsStr.split(",").map(function(id){
        return parseInt(id, 10);
    });
}
var bankData = [];

if(bankIds.length > 0){
var bankSearch = search.create({
    type: "customrecord_me_csrec_bank_information",
    filters:[
       ['internalid','anyof', bankIds]
    ],
    columns:[
        "custrecord_me_bank_name",
        "custrecord_me_bank_account_name",
        "custrecord_msi_account_number"
    ]
});

bankSearch.run().each(function(result){

bankData.push({
    bank_name : result.getValue("custrecord_me_bank_name"),
    acc_name : result.getValue("custrecord_me_bank_account_name"),
    acc_no : result.getValue("custrecord_msi_account_number")
});

return true;

});
}

/* ==============================
   TERBILANG
============================== */
var totalPayment = totalAmountLine + totalTaxAmountLine;
log.debug("totalQty",siData.totalQty);
log.debug("totalPayment",totalPayment);
var hasilTerbilang = utilLib.terbilang(totalPayment);
var dataTotal = {
    total : utilLib.formatRupiah(totalPayment),
    terbilang : hasilTerbilang
};

siData.totalPayment =  utilLib.formatRupiah(totalPayment);

/* ==============================
   RENDER PDF
============================== */

var renderer = render.create();
log.debug("Data",siData);
renderer.addCustomDataSource({
    format: render.DataSource.JSON,
    alias: "si",
    data: JSON.stringify(siData)
});

renderer.addCustomDataSource({
    format: render.DataSource.JSON,
    alias: "bankData",
    data: JSON.stringify({
        banks: bankData
    })
});

renderer.addCustomDataSource({
    format: render.DataSource.OBJECT,
    alias: "terbilangData",
    data: dataTotal
});

renderer.setTemplateByScriptId({
    scriptId: "CUSTTMPL_MSI_INVOICE"
});

var pdfFile = renderer.renderAsPdf();
context.response.writeFile(pdfFile,true);
}
    return {
        onRequest: onRequest
    };
});