/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * =============================================
 * STATUS CODES (shipmentstatus)
 * status_code       | status_name
 * ------------------|-----------------------------
 * toBeShipped       | To be Shipped
 * inTransit         | In Transit
 * partiallyReceived | Partially Received
 * received          | Fully Received
 * closed            | Closed
 * =============================================
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

    /**
     * Konversi ISO 8601 (misal: "2025-11-18T23:59:00+07:00")
     * ke format Oracle SQL: "YYYY-MM-DD HH24:MI:SS"
     * Timezone offset diabaikan — waktu lokal dipertahankan apa adanya
     * karena NetSuite menyimpan tanggal dalam timezone akun (WIB)
     */
    const parseISOToOracle = (isoStr) => {
        if (!isoStr) return null;
        // Ambil date dan time langsung dari string, tanpa konversi timezone
        // "2025-11-18T23:59:00+07:00" -> "2025-11-18 23:59:00"
        // "2025-11-18" -> "2025-11-18 00:00:00"
        let match = isoStr.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/);
        if (!match) return isoStr;
        let datePart = match[1];
        let timePart = match[2] || '00:00:00';
        return `${datePart} ${timePart}`;
    };

    const post = (body) => {

        try {

            let page = body.page || 1;
            let pageSize = body.page_size || 20;
            let offset = (page - 1) * pageSize;

            let filters = body.filters || {};
            let conditions = [];
            let params = [];

            if (filters.shipment_number) {
                conditions.push("s.shipmentnumber = ?");
                params.push(filters.shipment_number);
            }

            if (filters.id) {
                if (Array.isArray(filters.id)) {
                    let placeholders = filters.id.map(() => '?').join(', ');
                    conditions.push(`s.id IN (${placeholders})`);
                    filters.id.forEach(v => params.push(v));
                } else {
                    conditions.push("s.id = ?");
                    params.push(filters.id);
                }
            }

            if (filters.vendor_id) {
                conditions.push("s.entity = ?");
                params.push(filters.vendor_id);
            }

            if (filters.status) {
                conditions.push("s.shipmentstatus = ?");
                params.push(filters.status);
            }

            if (filters.lastmodified) {
                conditions.push("s.lastmodifieddate >= TO_DATE(?, 'YYYY-MM-DD HH24:MI:SS')");
                params.push(parseISOToOracle(filters.lastmodified));
            }

            let whereClause = "";
            if (conditions.length > 0) {
                whereClause = "WHERE " + conditions.join(" AND ");
            }

            let sortBy = body.sort_by || "s.id";
            let sortOrder = body.sort_order || "DESC";

            let sql = `
                SELECT
                    s.id,
                    s.shipmentnumber,
                    s.externaldocumentnumber,
                    s.externalid,
                    s.shipmentstatus,
                    s.expectedshippingdate,
                    s.actualshippingdate,
                    s.expecteddeliverydate,
                    s.actualdeliverydate,
                    s.shipmentmemo,
                    s.vesselnumber,
                    s.billoflading,
                    s.shipmentcreateddate,
                    s.lastmodifieddate,
                    s.custrecord_me_port,
                    isi.id AS item_line_id,
                    isi.purchaseordertransaction AS po_id,
                    t.tranid AS po_number,
                    isi.shipmentitemdescription AS item_description,
                    isi.vendorid AS vendor_id,
                    BUILTIN.DF(isi.vendorid) AS vendor_name,
                    isi.receivinglocation AS receiving_location_id,
                    BUILTIN.DF(isi.receivinglocation) AS receiving_location_name,
                    isi.quantityexpected,
                    isi.quantityreceived,
                    isi.quantityremaining,
                    isi.porate,
                    isi.shipmentitemamount
                FROM
                    InboundShipment s
                LEFT JOIN
                    InboundShipmentItem isi
                ON
                    s.id = isi.inboundshipment
                LEFT JOIN
                    Transaction t
                ON
                    isi.purchaseordertransaction = t.id
                ${whereClause}
                ORDER BY ${sortBy} ${sortOrder}
            `;

            let results = query.runSuiteQL({
                query: sql,
                params: params
            }).asMappedResults();

            let shipments = new Map();

            results.forEach(r => {

                if (!shipments.has(r.id)) {
                    shipments.set(r.id, {
                        id: r.id,
                        shipment_number: r.shipmentnumber,
                        external_doc_number: r.externaldocumentnumber,
                        external_id: r.externalid,
                        status: r.shipmentstatus,
                        expected_shipping_date: r.expectedshippingdate,
                        actual_shipping_date: r.actualshippingdate,
                        expected_delivery_date: r.expecteddeliverydate,
                        actual_delivery_date: r.actualdeliverydate,
                        memo: r.shipmentmemo,
                        vessel_number: r.vesselnumber,
                        bill_of_lading: r.billoflading,
                        date_created: r.shipmentcreateddate,
                        last_modified: formatToISO(r.lastmodifieddate),
                        port: r.custrecord_me_port,
                        items: []
                    });
                }

                if (r.item_line_id) {
                    shipments.get(r.id).items.push({
                        line_id: r.item_line_id,
                        po_id: r.po_id,
                        po_number: r.po_number,
                        item_description: r.item_description,
                        vendor_id: r.vendor_id,
                        vendor_name: r.vendor_name,
                        receiving_location_id: r.receiving_location_id,
                        receiving_location_name: r.receiving_location_name,
                        qty_expected: r.quantityexpected,
                        qty_received: r.quantityreceived,
                        qty_remaining: r.quantityremaining,
                        po_rate: r.porate,
                        shipment_item_amount: r.shipmentitemamount
                    });
                }

            });

            let shipmentArray = Array.from(shipments.values());

            let paginated = shipmentArray.slice(offset, offset + pageSize);

            return {
                status: "success",
                page: page,
                page_size: pageSize,
                total_records: shipmentArray.length,
                total_pages: Math.ceil(shipmentArray.length / pageSize),
                data: paginated
            };

        } catch (e) {

            return {
                status: "error",
                message: e.message
            };

        }

    };

    return { post };

});