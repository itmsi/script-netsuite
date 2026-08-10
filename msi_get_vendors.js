/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Vendor dengan pagination & filters.
 *
 * POST body:
 {
   "page": 1,               // Halaman (default: 1)
   "page_size": 50,         // Jumlah data per halaman (default: 50)
   "sort_by": "lastmodified", // Field untuk sorting (default: lastmodified)
   "sort_order": "DESC",    // ASC atau DESC (default: DESC)
   "filters": {
     "internalid": [1, 2],        // Filter by internal ID (opsional, bisa array)
     "entityid": "VEND-001",      // Filter by Entity ID (opsional)
     "companyname": "PT Vendor",  // Filter by Company Name (opsional, support contains)
     "email": "[EMAIL_ADDRESS]", // Filter by Email (opsional)
     "phone": "08123456789",       // Filter by Phone (opsional)
     "lastmodified": "2026-03-31T23:59:00+07:00" // Filter tanggal diubah (opsional)
   }
 }
 */

define(['N/search'], (search) => {

    function formatToISO(dateStr) {
        if (!dateStr) return null;

        // Match: 21/11/2025 4:10 PM
        const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
        const m = dateStr.match(regex);
        if (!m) return dateStr; // fallback: return original

        const day = parseInt(m[1]);
        const month = parseInt(m[2]);
        const year = parseInt(m[3]);
        let hour = parseInt(m[4]);
        const minute = parseInt(m[5]);
        const ampm = m[6].toUpperCase();

        // Convert AM/PM → 24h
        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;

        // Create JS date (local)
        const d = new Date(year, month - 1, day, hour, minute, 0);

        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, "0");
        const D = String(d.getDate()).padStart(2, "0");
        const HH = String(d.getHours()).padStart(2, "0");
        const MM = String(d.getMinutes()).padStart(2, "0");
        const SS = "00";

        return `${Y}-${M}-${D}T${HH}:${MM}:${SS}+07:00`;
    }

    function post(requestBody) {

        let page = parseInt(requestBody.page) || 1;
        let pageSize = parseInt(requestBody.pageSize || requestBody.page_size) || 50;
        let sortBy = requestBody.sort_by || 'lastmodifieddate';
        let sortOrder = (requestBody.sort_order || 'DESC').toUpperCase() === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

        let filtersBody = requestBody.filters || {};

       // Filter is_inactive: true → inactive saja, false → aktif saja, tidak dikirim → semua
        let filters = [];
        if (filtersBody.is_inactive === true || filtersBody.is_inactive === 'true') {
            filters.push(["isinactive", "is", "T"]);
        } else if (filtersBody.is_inactive === false || filtersBody.is_inactive === 'false') {
            filters.push(["isinactive", "is", "F"]);
        }

        // Add last modified filter
        if (filtersBody.lastmodified) {
            // Ambil komponen tanggal/jam APA ADANYA dari string ISO input (bukan
            // lewat new Date() + getUTCHours()+7) - konversi manual UTC->WIB itu
            // ada bug overflow (jam >=24 di-mod tanpa nambah hari), dan tetap
            // bergantung ke asumsi offset yang gak dijamin benar. Asumsi di sini:
            // offset di payload sama dengan timezone akun NetSuite (WIB, +07:00).
            let lmMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(filtersBody.lastmodified));
            if (!lmMatch) {
                throw new Error("filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + filtersBody.lastmodified + "'.");
            }

            let lmSqlDate = lmMatch[1] + '-' + lmMatch[2] + '-' + lmMatch[3] + ' ' +
                lmMatch[4] + ':' + lmMatch[5] + ':' + (lmMatch[6] || '00');

            // Formula filter dgn TO_DATE + format mask eksplisit -> gak bergantung
            // locale/timezone akun sama sekali, beda dari filter string biasa.
            let lmFormula = "formulanumeric: CASE WHEN {lastmodifieddate} >= TO_DATE('" + lmSqlDate + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END";
            if (filters.length > 0) filters.push("AND");
            filters.push([lmFormula, "equalto", "1"]);
        }

        if (filtersBody.internalid) {
            if (filters.length > 0) filters.push("AND");
            filters.push(["internalid", "anyof", filtersBody.internalid]);
        }
        if (filtersBody.entityid) {
            if (filters.length > 0) filters.push("AND");
            filters.push(["entityid", "is", filtersBody.entityid]);
        }
        if (filtersBody.companyname) {
            if (filters.length > 0) filters.push("AND");
            filters.push(["companyname", "contains", filtersBody.companyname]);
        }
        if (filtersBody.email) {
            if (filters.length > 0) filters.push("AND");
            filters.push(["email", "is", filtersBody.email]);
        }
        if (filtersBody.phone) {
            if (filters.length > 0) filters.push("AND");
            filters.push(["phone", "is", filtersBody.phone]);
        }

        let columns = [
            "internalid",
            "entityid",
            "companyname",
            "email",
            "phone",
            "subsidiarynohierarchy",
            "isinactive",
            "lastmodifieddate"
        ].map(col => col === sortBy ? search.createColumn({ name: col, sort: sortOrder }) : col);

        if (!["internalid", "entityid", "companyname", "email", "phone", "subsidiarynohierarchy", "isinactive", "lastmodifieddate"].includes(sortBy)) {
             columns.push(search.createColumn({ name: sortBy, sort: sortOrder }));
        }

        // Vendor search
        const vendorSearch = search.create({
            type: search.Type.VENDOR,
            filters: filters.length > 0 ? filters : undefined,
            columns: columns
        });

        // Paging
        const pagedData = vendorSearch.runPaged({ pageSize });

        if (pagedData.count === 0 || page > pagedData.pageRanges.length) {
            return {
                success: true,
                page: page,
                pageSize: pageSize,
                totalRows: pagedData.count,
                totalPages: pagedData.pageRanges.length,
                data: []
            };
        }

        const searchPage = pagedData.fetch({ index: page - 1 });

        // Map result
        const data = searchPage.data.map(result => {
            return {
                internalId: result.getValue("internalid"),
                entityId: result.getValue("entityid"),
                companyName: result.getValue("companyname"),
                email: result.getValue("email"),
                phone: result.getValue("phone"),
                subsidiary: result.getValue("subsidiarynohierarchy"),
                subsidiary_display: result.getText("subsidiarynohierarchy"),
                is_inactive: result.getValue("isinactive"),
                lastModifiedDate: formatToISO(result.getValue("lastmodifieddate")),
                lastModifiedDateRaw: result.getValue("lastmodifieddate")
            };
        });

        return {
            success: true,
            page: page,
            pageSize: pageSize,
            totalRows: pagedData.count,
            totalPages: pagedData.pageRanges.length,
            data
        };
    }

    return { post };
});

