/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/query'], (query) => {

    // Konversi "T"/"F" string ke boolean
    const toBool = (val) => val === 'T' || val === true;

    // Konversi ISO string ("2025-11-17T23:59:00+07:00") -> "YYYY-MM-DD HH:MI:SS"
    // buat bind param TO_DATE. Ambil komponen apa adanya dari string (bukan lewat
    // new Date()), karena mask 'YYYY-MM-DD HH24:MI:SS' gak cocok sama format ISO
    // asli (ada 'T' dan offset timezone) - sebelumnya string ISO dilempar mentah2
    // ke TO_DATE tanpa reformat, jadi mismatch format & bisa gagal parse.
    const isoToOracleDateTime = (isoStr) => {
        if (!isoStr) return null;
        const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2}))?/.exec(String(isoStr));
        if (!match) return null;
        return `${match[1]} ${match[2] || '00:00:00'}`;
    };

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
                const lmOracleDateTime = isoToOracleDateTime(filters.lastmodified);
                if (!lmOracleDateTime) {
                    throw new Error(`filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '${filters.lastmodified}'.`);
                }
                conditions.push(`l.lastmodifieddate >= TO_DATE(?, 'YYYY-MM-DD HH24:MI:SS')`);
                params.push(lmOracleDateTime);
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
                    TO_CHAR(l.lastmodifieddate, 'YYYY-MM-DD HH24:MI:SS') AS lastmodifieddate
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
                last_modified            : r.lastmodifieddate ? r.lastmodifieddate.replace(' ', 'T') + '+07:00' : null
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
