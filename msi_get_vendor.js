/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Vendor dengan pagination & filters.
 *
 * POST body:
 * {
 *   "page": 1,               // Halaman (default: 1)
 *   "page_size": 50,         // Jumlah data per halaman (default: 50)
 *   "sort_by": "lastmodifieddate", // Field untuk sorting (default: lastmodifieddate)
 *   "sort_order": "DESC",    // ASC atau DESC (default: DESC)
 *   "filters": {
 *     "lastmodified": "2026-03-31T23:59:00+07:00", // Filter tanggal diubah (opsional)
 *     "internalid": [1, 2],        // Filter by internal ID (opsional, bisa array)
 *     "entityid": "VEND-001",      // Filter by Entity ID (opsional)
 *     "companyname": "PT Vendor",  // Filter by Company Name (opsional, support contains)
 *     "email": "[EMAIL_ADDRESS]", // Filter by Email (opsional)
 *     "phone": "08123456789"       // Filter by Phone (opsional)
 *   }
 * }
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

    function isoToNetSuiteDate(isoStr) {
        if (!isoStr) return null;

        // Parse ISO 8601 string
        const d = new Date(isoStr); // ini sudah menghitung +07 dengan benar

        const day = d.getDate();
        const month = d.getMonth() + 1;
        const year = d.getFullYear();

        let hour = d.getHours();
        const minute = d.getMinutes();

        let ampm = "AM";
        if (hour >= 12) {
            ampm = "PM";
            if (hour > 12) hour -= 12;
        } else if (hour === 0) {
            hour = 12; // 00:00 → 12 AM
        }

        return `${day}/${month}/${year} ${hour}:${String(minute).padStart(2, "0")} ${ampm}`;
    }


    function post(requestBody) {

        let page = parseInt(requestBody.page) || 1;
        let pageSize = parseInt(requestBody.pageSize || requestBody.page_size) || 50;
        let sortBy = requestBody.sort_by || 'lastmodifieddate';
        let sortOrder = (requestBody.sort_order || 'DESC').toUpperCase() === 'ASC' ? search.Sort.ASC : search.Sort.DESC;
        
        let filtersBody = requestBody.filters || {};
        let lastModified = isoToNetSuiteDate(filtersBody.lastmodified) || null;

        // Base filter: active vendors only
        let filters = [["isinactive", "is", "F"]];

        // Add last modified filter
        if (lastModified) {
            filters.push("AND", ["lastmodifieddate", "onorafter", lastModified]);
        }

        if (filtersBody.internalid) {
            filters.push("AND", ["internalid", "anyof", filtersBody.internalid]);
        }
        if (filtersBody.entityid) {
            filters.push("AND", ["entityid", "is", filtersBody.entityid]);
        }
        if (filtersBody.companyname) {
            filters.push("AND", ["companyname", "contains", filtersBody.companyname]);
        }
        if (filtersBody.email) {
            filters.push("AND", ["email", "is", filtersBody.email]);
        }
        if (filtersBody.phone) {
            filters.push("AND", ["phone", "is", filtersBody.phone]);
        }

        let columns = [
            "internalid",
            "entityid",
            "companyname",
            "email",
            "phone",
            "lastmodifieddate"
        ].map(col => col === sortBy ? search.createColumn({ name: col, sort: sortOrder }) : col);

        if (!["internalid", "entityid", "companyname", "email", "phone", "lastmodifieddate"].includes(sortBy)) {
             columns.push(search.createColumn({ name: sortBy, sort: sortOrder }));
        }

        // Vendor search
        const vendorSearch = search.create({
            type: search.Type.VENDOR,
            filters: filters,
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
        const data = searchPage.data.map(result => ({
            internalId: result.getValue("internalid"),
            entityId: result.getValue("entityid"),
            companyName: result.getValue("companyname"),
            email: result.getValue("email"),
            phone: result.getValue("phone"),
            lastModifiedDate: formatToISO(result.getValue("lastmodifieddate"))
        }));

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

