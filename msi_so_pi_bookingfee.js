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
    totalQty : 0
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
var totalBookingFee = 0;
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
        "custcol_msi_booking_fee_so"
    ]
});

lineSearch.run().each(function(result){

var bookingFee = parseFloat(result.getValue("custcol_msi_booking_fee_so")) || 0;
var qty = parseFloat(result.getValue("quantity")) || 0;
var amountBookingFee = bookingFee * qty;
totalBookingFee += amountBookingFee;
totalQtyLine += qty;
  
soData.items.push({
    item : result.getText("item"),
    quantity : qty,
    custcol_msi_booking_fee_so : utilLib.formatRupiah(bookingFee),
    amount : utilLib.formatRupiah(amountBookingFee)
});

return true;
});

soData.totalQty = totalQtyLine;


/* ==============================
   TERBILANG
============================== */
var hasilTerbilang = utilLib.terbilang(totalBookingFee);
var dataTotal = {
    total : utilLib.formatRupiah(totalBookingFee),
    terbilang : hasilTerbilang
};


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

renderer.setTemplateByScriptId({
    scriptId: "CUSTTMPL_MSI_PI_BOOKING_FEE"
});

var pdfFile = renderer.renderAsPdf();
context.response.writeFile(pdfFile,true);

}

return {
    onRequest: onRequest
};

});