/**
 * @NApiVersion 2.1
 * @NScriptType ScheduledScript
 *
 * AMBIL KURS dari BI (Bank Indonesia) & Create Currency Exchange Rate di NetSuite
 *
 * Jadwalkan script ini via Deploy Script → Schedule → Daily
 *
 * Yang diambil:
 *   - USD → IDR
 *   - CNY → IDR
 *   - CNH → IDR
 *   - SGD → IDR
 *
 * Rumus: (beli_subkurslokal + jual_subkurslokal) / 2 = final rate
 *
 * Source: https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursLokal2?tgl=YYYY-MM-DD
 */
define(['N/https', 'N/record', 'N/log', 'N/search'], (https, record, log, search) => {

    // Helper delay synchronous (setTimeout tidak tersedia di SuiteScript)
    const delay = (ms) => {
        const start = Date.now();
        while (Date.now() - start < ms) {
            // busy wait
        }
    };

    /**
     * Entry point - dijalankan oleh Scheduled Script
     */
    const execute = (context) => {
        try {
            // Delay 1 menit agar data kurs BI sudah pasti terupdate (schedule hanya bisa set jam 8)
            delay(60000);

            // Paksa UTC+7 (WIB) karena NetSuite server bisa beda timezone
            const now = new Date();
            const wib = new Date(now.getTime() + (7 * 60 * 60 * 1000));
            const dateStr = wib.getUTCFullYear() + '-' +
                String(wib.getUTCMonth() + 1).padStart(2, '0') + '-' +
                String(wib.getUTCDate()).padStart(2, '0');

            // ── 1. Fetch dari BI ─────────────────────────────────────────────
            const url = 'https://www.bi.go.id/biwebservice/wskursbi.asmx/getSubKursLokal2?tgl=' + dateStr;
            const response = https.get({ url });

            if (response.code !== 200) {
                log.error('BI HTTP Error', 'Code: ' + response.code + ' | Body: ' + response.body);
                return;
            }

            // ── 2. Parse XML → ambil USD & CNY ──────────────────────────────
            const rates = parseBIRates(response.body);

            if (rates.length === 0) {
                log.error('No rates', 'Tidak ada data kurs dari BI untuk tanggal ' + dateStr);
                return;
            }

            // ── 3. Cari Internal ID Currency ─────────────────────────────────
            const idrId = getCurrencyInternalId('IDR');
            if (!idrId) {
                log.error('Currency Error', 'Base currency IDR tidak ditemukan di NetSuite');
                return;
            }

            const targetCurrencies = ['USD', 'CNY', 'CNH', 'SGD'];
            let created = 0;

            // ── 4. Siapkan format date ───────────────────────────────────────
            // Format untuk BI URL: YYYY-MM-DD (sudah ada dateStr)
            // Format untuk NetSuite: D/M/YYYY (contoh: 15/6/2026)
            const year   = wib.getUTCFullYear();
            const month  = wib.getUTCMonth() + 1; // 1-based
            const day    = wib.getUTCDate();
            const dateStrNS = day + '/' + month + '/' + year;
            const effectiveDate = new Date(year, month - 1, day); // midnight lokal

            for (let i = 0; i < rates.length; i++) {
                const rateInfo = rates[i];

                // Skip kalo bukan target (CNH dll)
                if (targetCurrencies.indexOf(rateInfo.currencyCode) === -1) continue;

                const currencyId = getCurrencyInternalId(rateInfo.currencyCode);
                if (!currencyId) {
                    log.error('Currency Error', 'Currency ' + rateInfo.currencyCode + ' tidak ditemukan di NetSuite');
                    continue;
                }

                const result = createOrUpdateExchangeRate(idrId, currencyId, rateInfo.averageRate, effectiveDate, dateStr, dateStrNS);
                if (result) {
                    created++;
                    log.debug('Save Success', rateInfo.currencyCode + ': ' + result.action + ' (ID: ' + result.recordId + ', Rate: ' + rateInfo.averageRate + ')');
                } else {
                    log.debug('Save Failed', rateInfo.currencyCode + ': gagal disave, cek log error di atas');
                }
            }

            log.audit('Selesai', 'Berhasil sync ' + created + ' exchange rate untuk tanggal ' + dateStr);

        } catch (e) {
            log.error('Script Error', e.message + (e.stack ? ' | ' + e.stack : ''));
        }
    };

    // ─── Helper: Rounding ──────────────────────────────────────────────────────

    /**
     * Bulatkan ke atas (ceiling) hingga max 3 digit desimal
     * Contoh: 17921.4567 → 17921.457, 13947.955 → 13947.955, 2650 → 2650
     */
    const roundUpTo3Decimals = (num, label) => {
        const hasMoreThan3Decimals = (num * 1000) % 1 !== 0;
        const result = hasMoreThan3Decimals ? Math.ceil(num * 1000) / 1000 : num;

        return result;
    };

    // ─── Helper: Parse XML BI ──────────────────────────────────────────────────

    /**
     * Parse response XML dari BI web service
     * Cari nilai beli & jual per currency
     */
    const parseBIRates = (xmlStr) => {
        const results = [];

        // Ambil tiap blok <Table>...</Table>
        const tableRegex = /<Table[^>]*>([\s\S]*?)<\/Table>/g;
        let match;

        while ((match = tableRegex.exec(xmlStr)) !== null) {
            const block = match[1];

            const beliMatch = /<beli_subkurslokal[^>]*>([^<]*)<\/beli_subkurslokal>/.exec(block);
            const jualMatch = /<jual_subkurslokal[^>]*>([^<]*)<\/jual_subkurslokal>/.exec(block);
            const mtsMatch  = /<mts_subkurslokal[^>]*>([^<]*)<\/mts_subkurslokal>/.exec(block);

            if (!beliMatch || !jualMatch || !mtsMatch) continue;

            const beli = parseFloat(beliMatch[1]);
            const jual = parseFloat(jualMatch[1]);
            const currencyCode = mtsMatch[1].trim();

            if (isNaN(beli) || isNaN(jual) || beli <= 0 || jual <= 0) continue;

            let average = (beli + jual) / 2;

            // Bulatkan ke atas max 3 digit desimal
            const rounded = roundUpTo3Decimals(average, currencyCode);

            results.push({
                currencyCode,
                buyRate:   beli,
                sellRate:  jual,
                averageRate: rounded
            });
        }

        return results;
    };

    // ─── Helper: Cari Internal ID Currency ─────────────────────────────────────

    /**
     * Cari internal ID currency record berdasarkan ISO 4217 code
     */
    const getCurrencyInternalId = (isoCode) => {
        const curSearch = search.create({
            type: 'currency',
            filters: [
                ['name', 'is', isoCode],
                'AND',
                ['isinactive', 'is', 'F']
            ],
            columns: ['internalid']
        });

        const results = curSearch.run().getRange({ start: 0, end: 1 });
        return (results && results.length > 0) ? results[0].id : null;
    };

    // ─── Helper: Create / Update Currency Exchange Rate ────────────────────────

    /**
     * Buat atau update currency exchange rate record
     */
    const createOrUpdateExchangeRate = (baseCurrencyId, currencyId, rateValue, effectiveDate, dateStrYmd, dateStrNS) => {
        try {
            // Cari record yang sudah ada
            const existingSearch = search.create({
                type: 'currencyrate',
                filters: [
                    ['basecurrency', 'anyof', baseCurrencyId],
                    'AND',
                    ['transactioncurrency', 'anyof', currencyId],
                    'AND',
                    ['effectivedate', 'on', dateStrNS]
                ],
                columns: ['internalid', 'exchangerate']
            });

            const existingResults = existingSearch.run().getRange({ start: 0, end: 1 });

            // currencyrate adalah system record — tidak bisa di-update via SuiteScript
            // Solusi: delete existing (jika ada) lalu create baru
            if (existingResults && existingResults.length > 0) {
                const existingId = existingResults[0].id;
                record.delete({
                    type: 'currencyrate',
                    id: existingId
                });
            }

            // ── CREATE baru ──
            const cr = record.create({
                type: 'currencyrate'
            });

            cr.setValue({ fieldId: 'basecurrency',        value: baseCurrencyId });
            cr.setValue({ fieldId: 'transactioncurrency', value: currencyId });
            cr.setValue({ fieldId: 'exchangerate',  value: rateValue });
            cr.setValue({ fieldId: 'effectivedate', value: effectiveDate });

            const recordId = cr.save();
            const action = existingResults && existingResults.length > 0 ? 'Recreated' : 'Created';

            return { action, recordId };
            log.debug('Create/Update Success', action + ' exchange rate record ID: ' + recordId + ' | Currency: ' + currencyId + ' | Rate: ' + rateValue);

        } catch (e) {
            log.error('Failed to save exchange rate',
                'Currency: ' + currencyId + ' | Rate: ' + rateValue + ' | Error: ' + e.message);
            return null;
        }
    };

    return { execute };
});
