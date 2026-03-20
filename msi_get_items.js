/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
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

        const pageSize = parseInt(requestBody.pageSize) || 50;
        const pageIndex = parseInt(requestBody.pageIndex) || 0;
        const lastModified = isoToNetSuiteDate(requestBody.lastmodified) || null;

        // Only active items
        let filters = [
            ["isinactive", "is", "F"]
        ];

        if (lastModified) {
            filters = [
                ["isinactive", "is", "F"],
                "AND",
                ["modified", "onorafter", lastModified]
            ];
        }

        const itemSearch = search.create({
            type: search.Type.ITEM,
            filters: filters,
            columns: [
                "itemid",
                "displayname",
                search.createColumn({
                    name: 'modified',
                    sort: search.Sort.DESC
                })
            ]
        });

        const pagedData = itemSearch.runPaged({ pageSize });

        if (pageIndex >= pagedData.pageRanges.length) {
            return {
                success: false,
                message: "Invalid pageIndex",
                totalRows: pagedData.count,
                totalPages: pagedData.pageRanges.length
            };
        }

        const page = pagedData.fetch({ index: pageIndex });
        const data = [];

        page.data.forEach(item => {

            const itemId = item.id;
            const rawDate = item.getValue("modified");

            const itemObj = {
                internalId: itemId,
                itemId: item.getValue("itemid"),
                displayName: item.getValue("displayname"),
                lastModifiedDate: formatToISO(rawDate),
                locations: []
            };

            const locationSearch = search.create({
                type: "inventoryitem",
                filters: [
                    ["internalid", "is", itemId]
                ],
                columns: [
                    "location",
                    "inventorylocation",
                    "locationquantityavailable",
                    "locationquantityonhand",
                    "locationquantityonorder",
                    "locationquantitycommitted",
                    "locationquantitybackordered",
                    "locationquantityintransit"
                ]
            });

            locationSearch.run().each(loc => {

                const locName = loc.getText("location");
                if (locName) {
                    itemObj.locations.push({
                        location: locName,
                        inventorylocation: loc.getText("inventorylocation"),
                        inventorylocationId: loc.getValue({ name: "inventorylocation" }),
                        qtyAvailable: loc.getValue("locationquantityavailable") || "0",
                        qtyOnHand: loc.getValue("locationquantityonhand") || "0",
                        qtyOnOrder: loc.getValue("locationquantityonorder") || "0",
                        qtyCommitted: loc.getValue("locationquantitycommitted") || "0",
                        qtyBackOrder: loc.getValue("locationquantitybackordered") || "0",
                        qtyInTransit: loc.getValue("locationquantityintransit") || "0"

                    });
                }
                return true;
            });

            data.push(itemObj);
        });

        return {
            success: true,
            pageIndex: pageIndex,
            pageSize: pageSize,
            totalRows: pagedData.count,
            totalPages: pagedData.pageRanges.length,
            data: data
        };
    }

    return { post };
});

