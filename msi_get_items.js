/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Item beserta lokasi dengan pagination & filters.
 *
 * POST body:
 {
   "page": 1,               // Halaman (default: 1)
   "page_size": 50,         // Jumlah data per halaman (default: 50)
   "sort_by": "lastmodified",   // Field untuk sorting (default: lastmodified)
   "sort_order": "DESC",    // ASC atau DESC (default: DESC)
   "filters": {
     "lastmodified": "2026-03-31T23:59:00+07:00", // Filter tanggal diubah (opsional)
     "internalid": [1, 2],        // Filter by internal ID (opsional, bisa array)
     "itemid": "ITEM-001",        // Filter by Item ID (opsional)
     "displayname": "Laptop",     // Filter by Display Name (opsional, support contains)
     "type_id": ["InvtPart"],     // Filter by internal type ID (opsional, array)
     "type": ["InvtPart"]         // Filter by Item Type (opsional, array)
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
        
        let sortMap = {
            'lastmodified': 'modified',
            'lastmodifieddate': 'modified'
        };
        let rawSortBy = requestBody.sort_by || 'lastmodified';
        let sortBy = sortMap[rawSortBy] || rawSortBy;
        
        let sortOrder = (requestBody.sort_order || 'DESC').toUpperCase() === 'ASC' ? search.Sort.ASC : search.Sort.DESC;
        
        let filtersBody = requestBody.filters || {};
        let lastModified = isoToNetSuiteDate(filtersBody.lastmodified) || null;

        // Only active items
        let filters = [
            ["isinactive", "is", "F"]
        ];

        if (lastModified) {
            filters.push("AND", ["modified", "onorafter", lastModified]);
        }

        if (filtersBody.internalid) {
            filters.push("AND", ["internalid", "anyof", filtersBody.internalid]);
        }
        if (filtersBody.itemid) {
            filters.push("AND", ["itemid", "is", filtersBody.itemid]);
        }
        if (filtersBody.displayname) {
            filters.push("AND", ["displayname", "contains", filtersBody.displayname]);
        }
        if (filtersBody.type_id) {
            filters.push("AND", ["type", "anyof", filtersBody.type_id]);
        }
        if (filtersBody.type) {
            filters.push("AND", ["type", "anyof", filtersBody.type]);
        }

        let columns = [
            "itemid",
            "displayname",
            "type",
            "modified"
        ].map(col => col === sortBy ? search.createColumn({ name: col, sort: sortOrder }) : col);

        if (!["itemid", "displayname", "type", "modified"].includes(sortBy)) {
             columns.push(search.createColumn({ name: sortBy, sort: sortOrder }));
        }

        const itemSearch = search.create({
            type: search.Type.ITEM,
            filters: filters,
            columns: columns
        });

        const pagedData = itemSearch.runPaged({ pageSize });

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
        const data = [];

        searchPage.data.forEach(item => {

            const itemId = item.id;
            const rawDate = item.getValue("modified");

            const itemObj = {
                internalId: itemId,
                itemId: item.getValue("itemid"),
                displayName: item.getValue("displayname"),
                type_id: item.getValue("type"),
                type: item.getText("type"),
                lastModifiedDate: formatToISO(rawDate),
                locations: []
            };

            // Fetch locations via item search
            try {
                var locSearch = search.create({
                    type: search.Type.ITEM,
                    filters: [
                        ["internalid", "anyof", itemId]
                    ],
                    columns: [
                        "internalid",
                        "inventorylocation",
                        "locationquantityavailable",
                        "locationquantityonhand",
                        "locationquantityonorder",
                        "locationquantitycommitted",
                        "locationquantitybackordered"
                    ]
                });

                // Build locations map (keyed by locationId for quick SN grouping later)
                var locMap = {};
                locSearch.run().each(function (row) {
                    var locId = row.getValue("inventorylocation");
                    var locName = row.getText("inventorylocation");
                    if (locId && !locMap[locId]) {
                        var locObj = {
                            location: locName || locId,
                            inventorylocationId: locId,
                            qtyAvailable: row.getValue("locationquantityavailable") || "0",
                            qtyOnHand: row.getValue("locationquantityonhand") || "0",
                            qtyOnOrder: row.getValue("locationquantityonorder") || "0",
                            qtyCommitted: row.getValue("locationquantitycommitted") || "0",
                            qtyBackOrder: row.getValue("locationquantitybackordered") || "0",
                            serialNumbers: []
                        };
                        locMap[locId] = locObj;
                        itemObj.locations.push(locObj);
                    }
                    return true;
                });

                // Fetch serial numbers with location via INVENTORY_NUMBER search
                var snSearch = search.create({
                    type: search.Type.INVENTORY_NUMBER,
                    filters: [
                        ["item", "anyof", itemId]
                    ],
                    columns: [
                        search.createColumn({ name: "inventorynumber" }),
                        search.createColumn({ name: "location" })
                    ]
                });

                var seenSn = {};
                snSearch.run().each(function(snRow) {
                    var sNum = snRow.getValue("inventorynumber");
                    var snLocId = snRow.getValue("location");
                    if (sNum && !seenSn[sNum]) {
                        seenSn[sNum] = true;
                        // Insert SN into the matching location
                        if (snLocId && locMap[snLocId]) {
                            locMap[snLocId].serialNumbers.push(sNum);
                        }
                    }
                    return true;
                });
            } catch (e) {
                log.debug('Location Load Error', 'Item ' + itemId + ': ' + e.message);
            }

            data.push(itemObj);
        });
        return {
            success: true,
            page: page,
            pageSize: pageSize,
            totalRows: pagedData.count,
            totalPages: pagedData.pageRanges.length,
            data: data
        };
    }

    return { post };
});

