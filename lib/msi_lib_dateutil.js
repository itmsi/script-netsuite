/**
 *@NApiVersion 2.1
 */
define([], () => {

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
        if (!isoStr) 
          return null;

        // Parse ISO 8601 
        const d = new Date(isoStr);

        // Ambil UTC lalu adjust ke WIB (+7)
        let hour = d.getUTCHours() + 7;
        const minute = d.getUTCMinutes();

        // Handle overflow (misal >24)
        if (hour >= 24) hour -= 24;

        const day = d.getUTCDate();
        const month = d.getUTCMonth() + 1;
        const year = d.getUTCFullYear();

        let ampm = hour >= 12 ? 'PM' : 'AM';
        let hour12 = hour % 12;
        if (hour12 === 0) hour12 = 12;

        return `${day}/${month}/${year} ${hour}:${String(minute).padStart(2, '0')} ${ampm}`;
    }

    return {
        formatToISO,
        isoToNetSuiteDate
    };
});