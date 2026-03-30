/**
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 */

define(['N/render','N/search','../MSI/lib/msi_lib_util'], function(render, search, utilLib) {
function onRequest(context){

var recId = context.request.parameters.recId;

/* ==============================
   GET SALES ORDER HEADER
============================== */
var soData = {
    subsidiary : "",
    tranid : "",
    trandate : "",
    quotationno : "",
    companyname : "",
    billaddress : "",
    items : [],
    totalQty : 0,
    subTotalAmount : 0,
    totalPayment : 0
};
  
var soSearch = search.create({
    type: search.Type.SALES_ORDER,
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
        "custbody_msi_quotation_no_iec",
        "custbody_msi_bank_payment_so",
        search.createColumn({
            name:"companyname",
            join:"customer"
        })
    ]
});

var soHeader = soSearch.run().getRange({start:0,end:1})[0];

soData.tranid = soHeader.getValue("tranid");
soData.trandate = soHeader.getValue("trandate");
soData.subsidiary = soHeader.getText("subsidiary");
soData.billaddress = soHeader.getValue("billaddress");
soData.quotationno = soHeader.getValue("custbody_msi_quotation_no_iec");
soData.companyname = soHeader.getValue({
    name:"companyname",
    join:"customer"
});
  
/* ==============================
   GET ITEM LINES
============================== */
var totalDownPayment = 0;
var totalQtyLine = 0;

var lineSearch = search.create({
    type: search.Type.SALES_ORDER,
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
        "item",
        "rate",
        "amount",
        "quantity",
        "custcol_msi_down_payment_percent"
    ]
});

lineSearch.run().each(function(result){

var qty =  parseFloat(result.getValue("quantity")) || 0;
var amountLine =  parseFloat(result.getValue("amount")) || 0;
var dpPercentageLine = parseFloat(result.getValue("custcol_msi_down_payment_percent")) || 0;
var amountDownPayment = amountLine * (dpPercentageLine / 100);;
totalDownPayment += amountDownPayment;
totalQtyLine += qty;
  
soData.items.push({
    item : result.getText("item"),
    quantity : qty,
    dpPercent : result.getValue("custcol_msi_down_payment_percent"),
    amount : utilLib.formatRupiah(amountDownPayment),
});

return true;
});

soData.totalQty = totalQtyLine;
soData.subTotalAmount = utilLib.formatRupiah(totalDownPayment);

/* ==============================
   SEARCH BANK
============================== */
var bankIdsStr = soHeader.getValue("custbody_msi_bank_payment_so");
var bankIds = bankIdsStr.split(",").map(function(id){
    return parseInt(id, 10);
});
var bankData = [];

if(bankIds){
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
   SEARCH CUSTOMER DEPOSIT BOOKING FEE
============================== */
var depositTotal = 0;
var depositSearch = search.create({
    type: search.Type.CUSTOMER_DEPOSIT,
    filters:[
        ["createdfrom","anyof",recId],
        "AND",
        ["custbody_msi_deposit_type","anyof","1"],
        "AND",
        ["mainline","is","T"]
    ],
    columns:[
        "amount"
    ]
});

depositSearch.run().each(function(result){
var amount = parseFloat(result.getValue("amount")) || 0;
depositTotal += amount;
return true;
});

var depositData = {
    depositTotal : utilLib.formatRupiah(depositTotal)
};

/* ==============================
   TERBILANG
============================== */
var totalPayment = totalDownPayment - depositTotal;
var hasilTerbilang = utilLib.terbilang(totalPayment);
var dataTotal = {
    total : utilLib.formatRupiah(totalPayment),
    terbilang : hasilTerbilang
};

soData.totalPayment =  utilLib.formatRupiah(totalPayment);

/* ==============================
   RENDER PDF
============================== */

var renderer = render.create();
log.debug("Data",soData);
renderer.addCustomDataSource({
    format: render.DataSource.JSON,
    alias: "so",
    data: JSON.stringify(soData)
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

renderer.addCustomDataSource({
    format: render.DataSource.OBJECT,
    alias: "depositData",
    data: depositData
});

renderer.setTemplateByScriptId({
    scriptId: "CUSTTMPL_MSI_PI_DOWN_PAYMENT"
});

var pdfFile = renderer.renderAsPdf();
context.response.writeFile(pdfFile,true);
}
    return {
        onRequest: onRequest
    };
});