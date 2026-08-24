/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Get List Project Segmentation (custom segment "cseg_msi_pro_segmen") via POST
 * Menggunakan N/search + runPaged supaya paging beneran di sisi NetSuite
 * (bukan tarik semua row lalu di-slice di JS).
 *
 * POST body:
 {
   "page"       : 1,
   "page_size"  : 20,
   "sort_by"    : "name",
   "sort_order" : "ASC",
   "filters": {
     "name"        : "Retail",
     "internalid"  : [1, 2, 3],
     "parent_id"   : 3,
     "is_inactive" : false,
     "lastmodified": "2026-01-01T00:00:00+07:00"
   }
 }
 *
 * sort_by values: "name" | "internalid" | "lastmodified"
 */
define(['N/search'], (search) => {

    const RECORD_TYPE = 'customrecord_cseg_msi_pro_segmen';

    function formatToISO(dateStr) {
        if (!dateStr) return null;

        const regex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
        const m = dateStr.match(regex);
        if (!m) return dateStr;

        const day = parseInt(m[1]);
        const month = parseInt(m[2]);
        const year = parseInt(m[3]);
        let hour = parseInt(m[4]);
        const minute = parseInt(m[5]);
        const ampm = m[6].toUpperCase();

        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;

        const d = new Date(year, month - 1, day, hour, minute, 0);

        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, "0");
        const D = String(d.getDate()).padStart(2, "0");
        const HH = String(d.getHours()).padStart(2, "0");
        const MM = String(d.getMinutes()).padStart(2, "0");

        return `${Y}-${M}-${D}T${HH}:${MM}:00+07:00`;
    }

    const ALLOWED_SORT = {
        'name': 'name',
        'internalid': 'internalid',
        'lastmodified': 'lastmodified'
    };

    function post(requestBody) {
        try {

            let page = parseInt(requestBody.page) || 1;
            let pageSize = parseInt(requestBody.pageSize || requestBody.page_size) || 20;

            let sortBy = ALLOWED_SORT[requestBody.sort_by] || 'name';
            let sortOrder = (requestBody.sort_order || 'ASC').toUpperCase() === 'DESC' ? search.Sort.DESC : search.Sort.ASC;

            let filtersBody = requestBody.filters || {};
            let filters = [];

            if (filtersBody.name) {
                if (filters.length) filters.push("AND");
                filters.push(["name", "contains", filtersBody.name]);
            }

            if (filtersBody.internalid || filtersBody.id) {
                if (filters.length) filters.push("AND");
                filters.push(["internalid", "anyof", filtersBody.internalid || filtersBody.id]);
            }

            if (filtersBody.parent_id) {
                if (filters.length) filters.push("AND");
                filters.push(["parent", "anyof", filtersBody.parent_id]);
            }

            if (filtersBody.is_inactive !== undefined && filtersBody.is_inactive !== null) {
                if (filters.length) filters.push("AND");
                filters.push(["isinactive", "is", filtersBody.is_inactive ? "T" : "F"]);
            }

            if (filtersBody.lastmodified) {
                // Ambil komponen tanggal/jam apa adanya dari string ISO input (bukan
                // lewat new Date() + local getter), sama seperti pola di msi_get_items.js -
                // asumsi offset payload sama dengan timezone akun NetSuite (WIB, +07:00).
                let lmMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(filtersBody.lastmodified));
                if (!lmMatch) {
                    throw new Error("filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + filtersBody.lastmodified + "'.");
                }
                let lmSqlDate = lmMatch[1] + '-' + lmMatch[2] + '-' + lmMatch[3] + ' ' +
                    lmMatch[4] + ':' + lmMatch[5] + ':' + (lmMatch[6] || '00');

                let lmFormula = "formulanumeric: CASE WHEN {lastmodified} >= TO_DATE('" + lmSqlDate + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END";
                if (filters.length) filters.push("AND");
                filters.push([lmFormula, "equalto", "1"]);
            }

            let columns = [
                "internalid",
                "name",
                "parent",
                "isinactive",
                "lastmodified"
            ].map(col => col === sortBy ? search.createColumn({ name: col, sort: sortOrder }) : col);

            const segSearch = search.create({
                type: RECORD_TYPE,
                filters: filters,
                columns: columns
            });

            const pagedData = segSearch.runPaged({ pageSize });

            if (pagedData.count === 0 || page > pagedData.pageRanges.length) {
                return {
                    status: 'success',
                    page: page,
                    page_size: pageSize,
                    total_records: pagedData.count,
                    total_pages: pagedData.pageRanges.length,
                    data: []
                };
            }

            const searchPage = pagedData.fetch({ index: page - 1 });
            const data = searchPage.data.map(row => {
                const fullName = row.getValue("name");
                const nameParts = fullName ? fullName.split(' : ') : [];
                const plainName = nameParts.length ? nameParts[nameParts.length - 1] : fullName;

                return {
                    id: row.getValue("internalid"),
                    name: plainName,
                    full_name: fullName,
                    is_inactive: row.getValue("isinactive") === true,
                    parent_id: row.getValue("parent") || null,
                    parent_name: row.getText("parent") || null,
                    last_modified: formatToISO(row.getValue("lastmodified"))
                };
            });

            return {
                status: 'success',
                page: page,
                page_size: pageSize,
                total_records: pagedData.count,
                total_pages: pagedData.pageRanges.length,
                data: data
            };

        } catch (e) {
            return {
                status: 'error',
                message: e.message || JSON.stringify(e)
            };
        }
    }

    return { post };
});
