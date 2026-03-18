/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record'], (record) => {

    const STATUS = {
        CLOSED_WON: 13
    };

    const post = (data) => {
        try {

            var customer = record.create({
                type: record.Type.CUSTOMER,
                isDynamic: true
            });

            // =============================
            // 1. IS PERSON / COMPANY
            // =============================
            var isPerson = data.isPerson || false;

            customer.setValue({
                fieldId: 'isperson',
                value: data.isPerson ? 'T' : 'F'
            });

            var name = '';

            if (isPerson) {
                customer.setValue({
                    fieldId: 'firstname',
                    value: data.firstName
                });

                customer.setValue({
                    fieldId: 'lastname',
                    value: data.lastName
                });

                name = (data.firstName || '') + ' ' + (data.lastName || '');

            } else {
                customer.setValue({
                    fieldId: 'companyname',
                    value: data.companyName
                });

                name = data.companyName || '';
            }

            // =============================
            // 2. SUBSIDIARY (PRIMARY)
            // =============================
            var primarySubsidiary = 3;

            customer.setValue({
                fieldId: 'subsidiary',
                value: data.subsidiary
            });

           // ===============================
            // MULTI SUBSIDIARY (SUBMACHINE)
            // ===============================
            var subsidiaries = data.subsidiaries || [];

            subsidiaries.forEach(function (sub, index) {

                customer.selectNewLine({
                    sublistId: 'submachine'
                });

                customer.setCurrentSublistValue({
                    sublistId: 'submachine',
                    fieldId: 'subsidiary',
                    value: sub
                });

                customer.setCurrentSublistValue({
                    sublistId: 'submachine',
                    fieldId: 'isprimesub',
                    value: (sub === primarySubsidiary) ? true : false
                });

                customer.commitLine({
                    sublistId: 'submachine'
                });

            });

            // =============================
            // 4. CUSTOM FIELDS
            // =============================
            var code = data.customer_code || '';

            customer.setValue({
                fieldId: 'custentity_me_numbering_code',
                value: code
            });

            customer.setValue({
                fieldId: 'custentity_me_lifetime',
                value: data.lifetime || 1
            });

            customer.setValue({
                fieldId: 'custentity_me_value',
                value: data.value || 1
            });

            // =============================
            // 5. ENTITY ID (AUTO GENERATE)
            // =============================
            var entityId = code
                ? (code + ' - ' + name)
                : name;

            customer.setValue({
                fieldId: 'entityid',
                value: entityId.trim()
            });

            // =============================
            // 6. STATUS (CLOSED WON)
            // =============================
            customer.setValue({
                fieldId: 'entitystatus',
                value: data.entitystatus || STATUS.CLOSED_WON
            });

            // =============================
            // 7. CONTACT INFO
            // =============================
            if (data.email) {
                customer.setValue({
                    fieldId: 'email',
                    value: data.email
                });
            }

            if (data.phone) {
                customer.setValue({
                    fieldId: 'phone',
                    value: data.phone
                });
            }

            // =============================
            // 8. ADDRESS
            // =============================
            if (data.address) {

                customer.selectNewLine({ sublistId: 'addressbook' });
                customer.setCurrentSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'defaultshipping',
                    value: data.address.defaultshipping ? true : false
                });

                customer.setCurrentSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'defaultbilling',
                    value: data.address.defaultbilling ? true : false
                });
              
                var subrec = customer.getCurrentSublistSubrecord({
                    sublistId: 'addressbook',
                    fieldId: 'addressbookaddress'
                });

                if (data.address.addr1)
                    subrec.setValue({ fieldId: 'addr1', value: data.address.addr1 });

                if (data.address.city)
                    subrec.setValue({ fieldId: 'city', value: data.address.city });

                if (data.address.state)
                    subrec.setValue({ fieldId: 'state', value: data.address.state });

                if (data.address.zip)
                    subrec.setValue({ fieldId: 'zip', value: data.address.zip });

                if (data.address.country)
                    subrec.setValue({ fieldId: 'country', value: data.address.country });

                customer.commitLine({ sublistId: 'addressbook' });
            }

            // =============================
            // 9. SAVE
            // =============================
            var customerId = customer.save();

            return {
                success: true,
                customerId: customerId,
                entityId: entityId
            };

        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }
    };

    return { post };
});