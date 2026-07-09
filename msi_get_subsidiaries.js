/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/search'], (search) => {

    /**
     * POST handler - Get list of Subsidiaries
     *
     * Request Body:
     {
       "page"       : 1,
       "page_size"  : 20,
       "sort_by"    : "name",
       "sort_order" : "ASC",
       "filters": {
         "id"         : ["1", "2"],
         "name"       : "MSI",
         "country"    : "ID",
         "currency"   : "1",
         "is_inactive": false,
         "lastmodified": "2025-11-17T23:59:00+07:00"
       }
     }
     *
     * Available sort_by:
     *   internalid, name, legalname, country, currency, tranprefix, languagelocale
     */
    const post = (body) => {

        try {

            const page = parseInt(body.page) || 1;
            const pageSize = Math.min(parseInt(body.page_size) || 20, 1000);
            const sortBy = body.sort_by || 'name';
            const sortOrder = (body.sort_order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            const filters = body.filters || {};

            // ── Build filters ─────────────────────────────────────────────────
            const searchFilters = [];

            // Default: hanya aktif, kecuali is_inactive = true
            if (filters.is_inactive === true || filters.is_inactive === 'true') {
                searchFilters.push(['isinactive', 'is', 'T']);
            } else {
                searchFilters.push(['isinactive', 'is', 'F']);
            }

            if (filters.id) {
                const ids = Array.isArray(filters.id) ? filters.id : [filters.id];
                searchFilters.push('AND', ['internalid', 'anyof', ids]);
            }

            if (filters.name) {
                searchFilters.push('AND', ['name', 'contains', filters.name.trim()]);
            }

            if (filters.country) {
                searchFilters.push('AND', ['country', 'is', filters.country.trim().toUpperCase()]);
            }

            if (filters.currency) {
                const ids = Array.isArray(filters.currency) ? filters.currency : [filters.currency];
                searchFilters.push('AND', ['currency', 'anyof', ids]);
            }

            // ── Sort ──────────────────────────────────────────────────────────
            const sortColName = sortBy === 'id' ? 'internalid' : sortBy;
            const sortDir = sortOrder === 'ASC' ? search.Sort.ASC : search.Sort.DESC;

            // ── Columns — sesuai field NetSuite apa adanya ───────────────────
            const columnDefs = [
                'isinactive', 'name', 'tranprefix',
                'country', 'legalname', 'currency', 'parent'
            ];

            const columns = columnDefs.map(name => {
                const colDef = { name };
                if (name === sortColName) colDef.sort = sortDir;
                return search.createColumn(colDef);
            });

            // internalid sort — prepend jika sort by id
            if (sortColName === 'internalid') {
                columns.unshift(search.createColumn({ name: 'internalid', sort: sortDir }));
            }

            // ── Run search ────────────────────────────────────────────────────
            const subSearch = search.create({
                type: search.Type.SUBSIDIARY,
                filters: searchFilters,
                columns: columns
            });

            const pagedData = subSearch.runPaged({ pageSize });
            const pageIndex = page - 1;
            const totalRecords = pagedData.count;
            const totalPages = pagedData.pageRanges.length;

            if (totalRecords === 0 || pageIndex >= pagedData.pageRanges.length) {
                return {
                    status: 'success',
                    page: page,
                    page_size: pageSize,
                    total_records: totalRecords,
                    total_pages: totalPages,
                    data: []
                };
            }

            const pageResult = pagedData.fetch({ index: pageIndex });

            // ── Map result — field name apa adanya ───────────────────────────
            const data = pageResult.data.map(r => ({
                internalid: String(r.id),
                isinactive: r.getValue('isinactive'),
                name: r.getValue('name'),
                tranprefix: r.getValue('tranprefix'),
                country: r.getValue('country'),
                legalname: r.getValue('legalname'),
                currency: r.getValue('currency'),
                currency_name: r.getText('currency'),
                parent: r.getValue('parent'),
            }));

            return {
                status: 'success',
                page: page,
                page_size: pageSize,
                total_records: totalRecords,
                total_pages: totalPages,
                data: data
            };

        } catch (e) {
            return {
                status: 'error',
                message: e.message
            };
        }
    };

    return { post };
});
