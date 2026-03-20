/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record'], (record) => {

    /**
     * POST handler - Get Location Detail by ID
     *
     * Request Body:
     * {
     *   "id" : "32"   // internalId of the Location (required)
     * }
     */
    function post(requestBody) {

        const locationId = requestBody.id;

        if (!locationId) {
            return {
                success: false,
                message: 'Parameter "id" is required.'
            };
        }

        let loc;
        try {
            loc = record.load({
                type: record.Type.LOCATION,
                id  : locationId
            });
        } catch (e) {
            return {
                success: false,
                message: `Location with id "${locationId}" not found.`,
                error  : e.message
            };
        }

        // Basic fields
        const result = {
            internalId            : String(loc.id),
            name                  : loc.getValue('name'),
            isInactive            : loc.getValue('isinactive'),
            subsidiaryId          : loc.getValue('subsidiary'),
            subsidiaryName        : loc.getText('subsidiary'),
            locationType          : loc.getValue('locationtype'),
            locationTypeName      : loc.getText('locationtype'),
            timezone              : loc.getValue('timezone'),
            makeInventoryAvailable: loc.getValue('makeinventoryavailable'),
            disallowNegativeStock : loc.getValue('disallownegativestock'),
            documentNumberPrefix  : loc.getValue('tranprefix'),
            logo                  : loc.getValue('logo'),
            latitude              : loc.getValue('latitude'),
            longitude             : loc.getValue('longitude'),
            parentId              : loc.getValue('parent'),
            parentName            : loc.getText('parent'),
            mainAddress           : null,
            returnAddress         : null
        };

        // Main Address (subrecord)
        try {
            const mainAddr = loc.getSubrecord({ fieldId: 'mainaddress' });
            result.mainAddress = {
                addr1      : mainAddr.getValue('addr1'),
                addr2      : mainAddr.getValue('addr2'),
                addr3      : mainAddr.getValue('addr3'),
                city       : mainAddr.getValue('city'),
                state      : mainAddr.getValue('state'),
                zip        : mainAddr.getValue('zip'),
                country    : mainAddr.getValue('country'),
                countryName: mainAddr.getText('country'),
                addrText   : mainAddr.getValue('addrtext')
            };
        } catch (e) {
            result.mainAddress = null;
        }

        // Return Address (subrecord)
        try {
            const retAddr = loc.getSubrecord({ fieldId: 'returnaddress' });
            result.returnAddress = {
                addr1      : retAddr.getValue('addr1'),
                addr2      : retAddr.getValue('addr2'),
                addr3      : retAddr.getValue('addr3'),
                city       : retAddr.getValue('city'),
                state      : retAddr.getValue('state'),
                zip        : retAddr.getValue('zip'),
                country    : retAddr.getValue('country'),
                countryName: retAddr.getText('country'),
                addrText   : retAddr.getValue('addrtext')
            };
        } catch (e) {
            result.returnAddress = null;
        }

        return {
            success: true,
            data   : result
        };
    }

    return { post };
});
