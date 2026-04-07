/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/query'], (query) => {

      function formatToISO(dateStr) {
    if (!dateStr) return null;

    // =========================
    // 1. FORMAT: DD/MM/YYYY HH:mm AM/PM
    // =========================
    var fullRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i;
    var m1 = dateStr.match(fullRegex);

    if (m1) {
        var day = parseInt(m1[1]);
        var month = parseInt(m1[2]);
        var year = parseInt(m1[3]);
        var hour = parseInt(m1[4]);
        var minute = parseInt(m1[5]);
        var ampm = m1[6].toUpperCase();

        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;

        return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}:00+07:00`;
    }

    // =========================
    // 2. FORMAT: DD/MM/YYYY (tanpa jam)
    // =========================
    var shortRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
    var m2 = dateStr.match(shortRegex);

    if (m2) {
        var day = parseInt(m2[1]);
        var month = parseInt(m2[2]);
        var year = parseInt(m2[3]);

        return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}T00:00:00+07:00`;
    }

    // =========================
    // 3. FALLBACK
    // =========================
    var d = new Date(dateStr);
    if (isNaN(d)) return dateStr;

    return d.toISOString();
}

    // Konversi "T"/"F" string ke boolean
    const toBool = (val) => val === 'T' || val === true;

    /**
     * POST handler - Get list of Locations
     *
     * Request Body:
     * {
     *   "page"       : 1,
     *   "page_size"  : 20,
     *   "sort_by"    : "l.name",
     *   "sort_order" : "ASC",
     *   "filters": {
     *     "name"         : "Jakarta",
     *     "id"           : ["1", "2", "3"],
     *     "subsidiary_id": "5",
     *     "lastmodified" : "2025-11-17T23:59:00+07:00"
     *   }
     * }
     */
    const post = (body) => {

        try {

            const page     = body.page      || 1;
            const pageSize = body.page_size  || 20;
            const offset   = (page - 1) * pageSize;
            const sortBy    = body.sort_by    || 'l.name';
            const sortOrder = (body.sort_order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

            const filters    = body.filters || {};
            const conditions = [];
            const params     = [];

            // Filter: name (contains)
            if (filters.name) {
                conditions.push(`LOWER(l.name) LIKE LOWER(?)`);
                params.push(`%${filters.name.trim()}%`);
            }

            // Filter: id (single or array)
            if (filters.id) {
                if (Array.isArray(filters.id)) {
                    const placeholders = filters.id.map(() => '?').join(', ');
                    conditions.push(`l.id IN (${placeholders})`);
                    filters.id.forEach(v => params.push(v));
                } else {
                    conditions.push(`l.id = ?`);
                    params.push(filters.id);
                }
            }

            // Filter: subsidiary_id
            if (filters.subsidiary_id) {
                conditions.push(`l.subsidiary = ?`);
                params.push(filters.subsidiary_id);
            }

            // Filter: location_type (e.g. "2" = Warehouse)
            if (filters.location_type) {
                conditions.push(`l.locationtype = ?`);
                params.push(filters.location_type);
            }

            // Filter: lastmodified (on or after)
            if (filters.lastmodified) {
                conditions.push(`l.lastmodifieddate >= TO_DATE(?, 'YYYY-MM-DD HH24:MI:SS')`);
                params.push(filters.lastmodified);
            }

            const whereClause = conditions.length > 0
                ? `WHERE ${conditions.join(' AND ')}`
                : '';

            // Single query — paginate in JavaScript (like Inbound Shipment pattern)
            const dataSql = `
                SELECT
                    l.id,
                    l.name,
                    l.isinactive,
                    l.parent                        AS parent_id,
                    BUILTIN.DF(l.parent)            AS parent_name,
                    l.subsidiary                    AS subsidiary_id,
                    BUILTIN.DF(l.subsidiary)        AS subsidiary_name,
                    l.locationtype                  AS location_type,
                    BUILTIN.DF(l.locationtype)      AS location_type_name,
                    l.timezone,
                    l.makeinventoryavailable,
                    l.lastmodifieddate
                FROM Location l
                ${whereClause}
                ORDER BY ${sortBy} ${sortOrder}
            `;

            const rows = query.runSuiteQL({ query: dataSql, params }).asMappedResults();

            const allData = rows.map(r => ({
                id                       : String(r.id),
                name                     : r.name,
                is_inactive              : toBool(r.isinactive),
                parent_id                : r.parent_id   ? String(r.parent_id) : null,
                parent_name              : r.parent_name || null,
                subsidiary_id            : r.subsidiary_id   ? String(r.subsidiary_id) : null,
                subsidiary_name          : r.subsidiary_name || null,
                location_type            : r.location_type   ? String(r.location_type) : null,
                location_type_name       : r.location_type_name || null,
                timezone                 : r.timezone || null,
                make_inventory_available : toBool(r.makeinventoryavailable),
                last_modified            : formatToISO(r.lastmodifieddate)
            }));

            const totalRecords = allData.length;
            const totalPages   = Math.ceil(totalRecords / pageSize);
            const paginated    = allData.slice(offset, offset + pageSize);

            return {
                status       : 'success',
                page         : page,
                page_size    : pageSize,
                total_records: totalRecords,
                total_pages  : totalPages,
                data         : paginated
            };

        } catch (e) {
            return {
                status : 'error',
                message: e.message
            };
        }
    };

    return { post };
});
