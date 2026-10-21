/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * RESTlet: ambil semua attachment file dari transaksi Vendor Prepayment
 *
 * Pemakaian:
 *   POST  body: { "id": "123" }   // internal id Vendor Prepayment
 *
 * Catatan:
 *   - File biner (PDF, gambar, Excel, ZIP, dll.) dikembalikan sebagai base64 (isText = false).
 *   - Total isi file dalam satu response dibatasi MAX_TOTAL_BYTES.
 *     File yang melebihi batas tidak diisi content-nya (skipped = true) dan diberi alasan.
 */
define(['N/search', 'N/file', 'N/log'], (search, file, log) => {

    // Batas total isi file per response (sebelum base64, base64 menambah sekitar 33%)
    const MAX_TOTAL_BYTES = 7 * 1024 * 1024;

    /**
     * Daftar id file yang ter-attach di Vendor Prepayment
     */
    const findAttachmentIds = (paymentId) => {
        const ids = [];
        let tranId = null;

        search.create({
            type: 'transaction',
            filters: [
                ['type', 'anyof', 'VPrep'], 'AND',
                ['internalid', 'anyof', paymentId], 'AND',
                ['mainline', 'is', 'T']
            ],
            columns: [
                search.createColumn({ name: 'tranid' }),
                search.createColumn({ name: 'internalid', join: 'file' })
            ]
        }).run().each((r) => {
            tranId = tranId || r.getValue({ name: 'tranid' });
            const id = r.getValue({ name: 'internalid', join: 'file' });
            if (id && ids.indexOf(id) === -1) ids.push(id);
            return true;
        });

        return { tranId, ids };
    };

    /**
     * Ambil satu file, isi content jika masih muat di sisa kuota
     */
    const readFile = (fileId, remainingBytes) => {
        try {
            const f = file.load({ id: fileId });

            const result = {
                id: String(f.id),
                name: f.name,
                fileType: f.fileType,
                size: f.size,
                isText: f.isText
            };

            if (f.size > remainingBytes) {
                result.skipped = true;
                result.message = 'Ukuran melebihi batas total response, file tidak disertakan';
                return { result, used: 0 };
            }

            result.skipped = false;
            result.content = f.getContents();
            return { result, used: f.size };

        } catch (e) {
            log.error({ title: 'Gagal membaca file ' + fileId, details: e });
            return {
                result: { id: String(fileId), skipped: true, error: e.name, message: e.message },
                used: 0
            };
        }
    };

    /**
     * Entry point POST
     */
    const post = (body) => {
        try {
            const paymentId = body && body.id;

            if (!paymentId) {
                return { success: false, message: 'Body wajib berisi "id" (internal id Vendor Prepayment)' };
            }

            const found = findAttachmentIds(paymentId);

            if (!found.tranId) {
                return { success: false, message: 'Vendor Prepayment dengan id ' + paymentId + ' tidak ditemukan' };
            }

            let remaining = MAX_TOTAL_BYTES;
            const files = found.ids.map((fileId) => {
                const r = readFile(fileId, remaining);
                remaining -= r.used;
                return r.result;
            });

            return {
                success: true,
                id: String(paymentId),
                tranId: found.tranId,
                count: files.length,
                skippedCount: files.filter((x) => x.skipped).length,
                files: files
            };

        } catch (e) {
            log.error({ title: 'RESTlet error', details: e });
            return { success: false, error: e.name, message: e.message };
        }
    };

    return { post };
});