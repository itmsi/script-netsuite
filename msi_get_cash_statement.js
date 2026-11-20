 /**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * GET data Cash Statement (saved search: customsearch_me_ss_cash_statement_ns)
 * - data    : detail per transaksi (semua field), dengan pagination
 * - summary : total per akun
 *
 * POST body (semua opsional):
 {
   "page"      : 1,                 // default 1
   "page_size" : 20,                // default 20, maks 1000
   "sort_by"   : "internalid",      // default "internalid". Pilihan: nama field di data (trandate, amount, tranid, dst)
   "sort_order": "DESC",            // "ASC" | "DESC" (default DESC)
   "date"      : "19/11/2026",      // as-of date (format tanggal NetSuite), default hari ini
   "filters"   : {
     "transaction_ids": [1, 2],     // internal id transaksi
     "tranid"        : "CHK-001",   // nomor transaksi
     "type"          : ["Journal", "Check"],  // kode tipe NetSuite: Journal, Check, Deposit, Transfer, VendPymt (Bill Payment)
     "account_ids"   : [786, 755],  // kosong = semua akun Bank (atau semua akun milik saved search)
     "lastmodified"  : "2026-03-31T23:59:00+07:00"  // lastmodifieddate >= nilai ini
   },
   "search_id" : [465, 466]         // opsional: id/script id saved search (satu atau array).
 }
 *
 * Tanpa search_id : detail semua akun Bank (atau sesuai filters.account_ids).
 * Dengan search_id: akun diambil dari kriteria saved search itu, lalu detail transaksinya
 *                   ditampilkan (field sama seperti di atas). Banyak search digabung jadi satu "data",
 *                   tiap baris punya "search_id" asalnya.
 *                   "summary" berisi hasil saved search apa adanya, juga bertanda "search_id".
 *
 * Response:
 {
   "status": "success",
   "page": 1, "page_size": 20, "total_records": 300, "total_pages": 15,
   "summary": [ { "account_id": "786", "account_name": "...", "amount": 0 } ],
   "data": [ { "internalid": "...", "type": "...", "tranid": "...", "trandate": "...", "account": "786", "account_display": "...", "amount": "1000.00", ... } ]
 }
 */
define(['N/search', 'N/format', 'N/log'], function (search, format, log) {

    // Field transaksi apa adanya (nama field NetSuite = key response, nilai tanpa transform)
    var DETAIL_FIELDS = [
        'internalid', 'line', 'type', 'tranid', 'trandate', 'postingperiod', 'status',
        'account', 'entity', 'memo', 'subsidiary', 'department', 'class', 'location',
        'currency', 'debitamount', 'creditamount', 'amount', 'datecreated', 'lastmodifieddate'
    ];

    var DATETIME_FIELDS = { datecreated: 1, lastmodifieddate: 1 };
    var SETTINGS = [{ name: 'consolidationtype', value: 'ACCTTYPE' }];

    // Batas baris per saved search saat digabung (jaga governance RESTlet)
    var MAX_ROWS_PER_SEARCH = 5000;

    function num(v) {
        return parseFloat(v) || 0;
    }

    // Sama dengan script lain: "21/11/2025 4:10 PM" -> "2025-11-21T16:10:00+07:00"
    function formatToISO(dateStr) {
        if (!dateStr) return null;

        var m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (!m) return dateStr; // fallback: return original

        var hour = parseInt(m[4], 10);
        var ampm = m[6].toUpperCase();
        if (ampm === 'PM' && hour !== 12) hour += 12;
        if (ampm === 'AM' && hour === 12) hour = 0;

        var d  = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), hour, parseInt(m[5], 10), 0);
        var pad = function (n) { return String(n).padStart(2, '0'); };

        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
               'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00+07:00';
    }

    // Filter dasar + filter tambahan khusus detail
    function buildFilters(asOfDate, f, accountIds, withExtras) {
        var list = [
            search.createFilter({ name: 'accounttype', operator: search.Operator.ANYOF, values: ['Bank'] }),
            search.createFilter({ name: 'posting',     operator: search.Operator.IS,    values: 'T' }),
            search.createFilter({ name: 'trandate',    operator: search.Operator.ONORBEFORE, values: asOfDate })
        ];

        // Default: semua akun Bank. Kalau ada daftar akun, batasi ke akun itu.
        if (accountIds && accountIds.length > 0) {
            list.push(search.createFilter({ name: 'account', operator: search.Operator.ANYOF, values: accountIds }));
        }
        if (!withExtras) return list;

        if (Array.isArray(f.transaction_ids) && f.transaction_ids.length > 0) {
            list.push(search.createFilter({ name: 'internalid', operator: search.Operator.ANYOF, values: f.transaction_ids }));
        }
        if (f.tranid) {
            list.push(search.createFilter({ name: 'tranid', operator: search.Operator.IS, values: String(f.tranid) }));
        }
        if (f.type) {
            list.push(search.createFilter({
                name: 'type', operator: search.Operator.ANYOF,
                values: Array.isArray(f.type) ? f.type : [f.type]
            }));
        }
        if (f.lastmodified) {
            // Komponen tanggal/jam diambil apa adanya dari string ISO (asumsi offset = timezone akun, +07:00)
            var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(f.lastmodified));
            if (!m) {
                throw new Error("filters.lastmodified tidak valid, gunakan format ISO 'YYYY-MM-DDTHH:mm:ss+07:00': '" + f.lastmodified + "'.");
            }
            var sqlDate = m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
            list.push(search.createFilter({
                name    : 'formulanumeric',
                formula : "CASE WHEN {lastmodifieddate} >= TO_DATE('" + sqlDate + "', 'YYYY-MM-DD HH24:MI:SS') THEN 1 ELSE 0 END",
                operator: search.Operator.EQUALTO,
                values  : '1'
            }));
        }
        return list;
    }

    // Search detail transaksi (semua field), terurut
    function buildDetailSearch(asOfDate, f, accountIds, sortBy, sortDir) {
        var columns = DETAIL_FIELDS.map(function (name) {
            return name === sortBy
                ? search.createColumn({ name: name, sort: sortDir })
                : search.createColumn({ name: name });
        });
        // tie-breaker supaya urutan (dan pagination) konsisten antar pemanggilan
        if (sortBy !== 'internalid') {
            columns.push(search.createColumn({ name: 'internalid', sort: search.Sort.DESC }));
        }
        if (sortBy !== 'line') {
            columns.push(search.createColumn({ name: 'line', sort: search.Sort.ASC }));
        }
        if (sortBy !== 'account') {
            columns.push(search.createColumn({ name: 'account', sort: search.Sort.ASC }));
        }
        return search.create({
            type    : 'transaction',
            settings: SETTINGS,
            filters : buildFilters(asOfDate, f, accountIds, true),
            columns : columns
        });
    }

    function mapDetailRow(columns, r) {
        var row = {};
        DETAIL_FIELDS.forEach(function (name, i) {
            var col = columns[i];
            var val = r.getValue(col);
            var txt = r.getText(col);
            row[name] = DATETIME_FIELDS[name] ? formatToISO(val) : val;
            if (!DATETIME_FIELDS[name] && txt && txt !== val) row[name + '_display'] = txt;
        });
        return row;
    }

    // Summary per akun
    function buildSummary(asOfDate, f, accountIds) {
        var sum = search.create({
            type    : 'transaction',
            settings: SETTINGS,
            filters : buildFilters(asOfDate, f, accountIds, false),
            columns : [
                search.createColumn({ name: 'account', summary: search.Summary.GROUP }),
                search.createColumn({ name: 'amount',  summary: search.Summary.SUM })
            ]
        });
        var cols = sum.columns;
        return sum.run().getRange({ start: 0, end: 1000 }).map(function (r) {
            return {
                account_id  : r.getValue(cols[0]) || null,
                account_name: r.getText(cols[0])  || null,
                amount      : num(r.getValue(cols[1]))
            };
        });
    }

    // ── Saved search ──────────────────────────────────────────────────────

    // Muat saved search (filter trandate di-override dengan as-of date)
    function loadSavedSearch(id, asOfDate) {
        var ss = search.load({ id: String(id) });
        // Getter ss.filters mengembalikan salinan: susun array dulu lalu assign sekali.
        var loadedFilters = ss.filters.filter(function (x) { return x.name !== 'trandate'; });
        loadedFilters.push(search.createFilter({
            name: 'trandate', operator: search.Operator.ONORBEFORE, values: asOfDate
        }));
        ss.filters = loadedFilters;
        return ss;
    }

    // Akun yang menjadi kriteria saved search (filter "account")
    function extractAccountIds(ss) {
        var ids = [];
        // Objek Filter hasil search.load tidak selalu expose properti langsung,
        // tapi serialisasi JSON-nya lengkap (name, values, isnot, ...).
        var plain = JSON.parse(JSON.stringify(ss.filters));
        plain.forEach(function (x) {
            if (String(x.name).toLowerCase() === 'account' && !x.isnot) {
                var vals = Array.isArray(x.values) ? x.values : [x.values];
                vals.forEach(function (v) {
                    if (v !== null && v !== undefined && v !== '' && ids.indexOf(String(v)) === -1) ids.push(String(v));
                });
            }
        });
        extractAccountIds.seenNames = plain.map(function (x) { return x.name; });
        return ids;
    }

    // Hasil saved search apa adanya (key dari label kolom) -> untuk "summary"
    function savedSearchRows(ss, id) {
        var columns = ss.columns;
        return ss.run().getRange({ start: 0, end: 1000 }).map(function (r) {
            var row = { search_id: id };
            columns.forEach(function (col) {
                var key = String(col.label || col.name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
                var val = r.getValue(col);
                var txt = r.getText(col);
                row[key] = val;
                if (txt && txt !== val) row[key + '_display'] = txt;
            });
            return row;
        });
    }

    // Ambil semua detail transaksi untuk satu saved search (maks MAX_ROWS_PER_SEARCH)
    function fetchDetailForSearch(id, asOfDate, f, sortBy, sortDir) {
        var ss = loadSavedSearch(id, asOfDate);

        var accountIds = extractAccountIds(ss);
        if (accountIds.length === 0) {
            throw new Error('Saved search ' + id + ' tidak punya kriteria Account, detail transaksi tidak bisa ditentukan. ' +
                'Filter yang terbaca: ' + JSON.stringify(extractAccountIds.seenNames || []));
        }
        // filters.account_ids (kalau ada) mempersempit akun milik saved search
        if (Array.isArray(f.account_ids) && f.account_ids.length > 0) {
            var wanted = f.account_ids.map(String);
            accountIds = accountIds.filter(function (a) { return wanted.indexOf(a) !== -1; });
            if (accountIds.length === 0) accountIds = ['0'];
        }

        var summaryRows = savedSearchRows(ss, id);

        var detail  = buildDetailSearch(asOfDate, f, accountIds, sortBy, sortDir);
        var columns = detail.columns;
        var paged   = detail.runPaged({ pageSize: 1000 });
        var rows    = [];
        var truncated = false;

        for (var i = 0; i < paged.pageRanges.length; i++) {
            if (rows.length >= MAX_ROWS_PER_SEARCH) { truncated = true; break; }
            paged.fetch({ index: i }).data.forEach(function (r) {
                var row = mapDetailRow(columns, r);
                row.search_id = id;
                rows.push(row);
            });
        }
        return { summary: summaryRows, rows: rows, truncated: truncated };
    }

    // Nilai sortir: angka untuk field numerik/tanggal, string untuk lainnya
    function sortValue(row, key) {
        var v = row[key];
        if (v === null || v === undefined || v === '') return null;
        if (key === 'trandate') {
            var d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v));
            return d ? new Date(parseInt(d[3], 10), parseInt(d[2], 10) - 1, parseInt(d[1], 10)).getTime() : null;
        }
        if (DATETIME_FIELDS[key]) return Date.parse(v) || null;
        if (/^-?\d+(\.\d+)?$/.test(String(v)) || String(v).charAt(0) === '.') return parseFloat(v);
        return String(v).toLowerCase();
    }

    function sortRows(rows, key, dir) {
        var mult = dir === search.Sort.ASC ? 1 : -1;
        return rows.sort(function (a, b) {
            var x = sortValue(a, key), y = sortValue(b, key);
            if (x === y) return 0;
            if (x === null) return 1;
            if (y === null) return -1;
            return (x < y ? -1 : 1) * mult;
        });
    }

    function post(context) {
        try {
            context = context || {};
            var page     = parseInt(context.page, 10) || 1;
            var pageSize = Math.min(parseInt(context.page_size, 10) || 20, 1000);
            var sortBy   = context.sort_by || 'internalid';
            var sortDir  = (context.sort_order || 'DESC').toUpperCase() === 'ASC' ? search.Sort.ASC : search.Sort.DESC;
            var f        = context.filters || {};

            if (DETAIL_FIELDS.indexOf(sortBy) === -1) {
                throw new Error("sort_by tidak valid: '" + sortBy + "'. Pilihan: " + DETAIL_FIELDS.join(', '));
            }

            var asOfDate = context.date
                ? String(context.date)
                : format.format({ value: new Date(), type: format.Type.DATE });

            var accountIds = Array.isArray(f.account_ids) ? f.account_ids.map(String) : [];

            // ── Dengan search_id (satu atau array): detail akun milik saved search, digabung ──
            var searchIds = context.search_id
                ? (Array.isArray(context.search_id) ? context.search_id : [context.search_id])
                : [];

            if (searchIds.length > 0) {
                var merged    = [];
                var summary   = [];
                var errors    = [];
                var truncated = [];

                searchIds.forEach(function (id) {
                    try {
                        var res = fetchDetailForSearch(id, asOfDate, f, sortBy, sortDir);
                        merged  = merged.concat(res.rows);
                        summary = summary.concat(res.summary);
                        if (res.truncated) truncated.push(id);
                    } catch (err) {
                        errors.push({ search_id: id, name: err.name, message: err.message });
                    }
                });

                sortRows(merged, sortBy, sortDir);

                var mTotal = merged.length;
                var mPages = Math.ceil(mTotal / pageSize);
                var mStart = (page - 1) * pageSize;
                var resp = {
                    status       : 'success',
                    page         : page,
                    page_size    : pageSize,
                    total_records: mTotal,
                    total_pages  : mPages,
                    summary      : summary,
                    data         : (page >= 1 && page <= mPages) ? merged.slice(mStart, mStart + pageSize) : []
                };
                if (errors.length)    resp.errors = errors;
                if (truncated.length) resp.truncated_search_ids = truncated;
                return resp;
            }

            // ── Tanpa search_id: detail semua akun Bank (atau sesuai account_ids) ──
            var ss      = buildDetailSearch(asOfDate, f, accountIds, sortBy, sortDir);
            var summary2 = buildSummary(asOfDate, f, accountIds);

            var pagedData   = ss.runPaged({ pageSize: pageSize });
            var totalRecords = pagedData.count;
            var totalPages   = pagedData.pageRanges.length;
            var pageIndex    = page - 1;

            var base = {
                status       : 'success',
                page         : page,
                page_size    : pageSize,
                total_records: totalRecords,
                total_pages  : totalPages,
                summary      : summary2
            };

            if (totalRecords === 0 || pageIndex < 0 || pageIndex >= totalPages) {
                base.data = [];
                return base;
            }

            var columns = ss.columns;
            base.data = pagedData.fetch({ index: pageIndex }).data.map(function (r) {
                return mapDetailRow(columns, r);
            });
            return base;

        } catch (e) {
            log.error({ title: 'msi_get_cash_statement', details: e });
            return {
                status : 'error',
                name   : e.name,
                message: e.message,
                stack  : e.stack
            };
        }
    }

    return { post: post };

});
