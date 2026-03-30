/**
 * @NApiVersion 2.x
 */
define([], function () {

    function penyebut(nilai) {
        nilai = Math.floor(nilai);
        var huruf = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
        var temp = "";

        if (nilai < 12) {
            temp = huruf[nilai];
        } else if (nilai < 20) {
            temp = penyebut(nilai - 10) + " Belas";
        } else if (nilai < 100) {
            temp = penyebut(Math.floor(nilai / 10)) + " Puluh " + penyebut(nilai % 10);
        } else if (nilai < 200) {
            temp = "Seratus " + penyebut(nilai - 100);
        } else if (nilai < 1000) {
            temp = penyebut(Math.floor(nilai / 100)) + " Ratus " + penyebut(nilai % 100);
        } else if (nilai < 2000) {
            temp = "Seribu " + penyebut(nilai - 1000);
        } else if (nilai < 1000000) {
            temp = penyebut(Math.floor(nilai / 1000)) + " Ribu " + penyebut(nilai % 1000);
        } else if (nilai < 1000000000) {
            temp = penyebut(Math.floor(nilai / 1000000)) + " Juta " + penyebut(nilai % 1000000);
        } else if (nilai < 1000000000000) {
            temp = penyebut(Math.floor(nilai / 1000000000)) + " Miliar " + penyebut(nilai % 1000000000);
        } else if (nilai < 1000000000000000) {
            temp = penyebut(Math.floor(nilai / 1000000000000)) + " Triliun " + penyebut(nilai % 1000000000000);
        }

        return temp;
    }

    function terbilang(nilai) {
        if (nilai < 0) {
            return "Minus " + penyebut(Math.abs(nilai));
        }
        return penyebut(nilai).trim() + " Rupiah";
    }

   function formatRupiah(num) {

        num = parseFloat(num) || 0;

        var parts = num.toFixed(2).split(".");
        var intPart = parts[0];
        var decimalPart = parts[1];

        intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

        return "Rp" + intPart + "," + decimalPart;
    }

    return {
        terbilang: terbilang,
        formatRupiah: formatRupiah
    };

});