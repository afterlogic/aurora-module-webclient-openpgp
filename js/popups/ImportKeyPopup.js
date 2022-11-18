'use strict';

var
	_ = require('underscore'),
	ko = require('knockout'),

	AddressUtils = require('%PathToCoreWebclientModule%/js/utils/Address.js'),
	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
	Types = require('%PathToCoreWebclientModule%/js/utils/Types.js'),

	CAbstractPopup = require('%PathToCoreWebclientModule%/js/popups/CAbstractPopup.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),

	ErrorsUtils = require('modules/%ModuleName%/js/utils/Errors.js'),

	Enums = require('modules/%ModuleName%/js/Enums.js'),
	OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js')
;

/**
 * @constructor
 */
function CImportKeyPopup()
{
	CAbstractPopup.call(this);

	this.keyArmor = ko.observable('');
	this.keyArmorFocused = ko.observable(false);

	this.keysOwn = ko.observableArray([]);
	this.keysPublicExternal = ko.observableArray([]);
	this.keysPrivateExternal = ko.observableArray([]);
	this.keysAlreadyThere = ko.observableArray([]);

	this.keysForContact = ko.observableArray([]);
	this.keysNotForContact = ko.observableArray([]);
	this.selectedKeyForContact = ko.observable('');

	this.keysBroken = ko.observableArray([]);

	this.keysChecked = ko.observable(false);

	this.shouldAddToPersonalContact = ko.observable('');
	this.contactEmail = ko.observable('');
	this.contactUUID = '';
	this.fOnSuccessCallback = null;
	
	this.visibleImportKeysButton = ko.computed(() => {
		if (this.shouldAddToPersonalContact()) {
			return this.keysForContact().length > 0;
		} else {
			return this.keysOwn().length > 0 || this.keysPublicExternal().length > 0;
		}
	});

	this.disabledForContactHeading = ko.computed(function () {
		const langConst = '%MODULENAME%/INFO_TEXT_CONTAINS_NOT_PUBLIC_KEYS_OR_WITHOUT_EMAIL';
		return TextUtils.i18n(langConst, {'EMAIL': this.contactEmail()});
	}, this);
}

_.extendOwn(CImportKeyPopup.prototype, CAbstractPopup.prototype);

CImportKeyPopup.prototype.PopupTemplate = '%ModuleName%_ImportKeyPopup';

/**
 * @param {string} armor
 * @param {function} onSuccessCallback
 * @param {boolean} shouldAddToPersonalContact
 * @param {string} contactEmail
 * @param {string} contactUUID
 */
CImportKeyPopup.prototype.onOpen = function ({ armor = '', onSuccessCallback = () => {},
	shouldAddToPersonalContact = false, contactEmail = '', contactUUID = '' })
{
	this.keyArmor(armor);
	this.keyArmorFocused(true);

	this.keysOwn([]);
	this.keysPublicExternal([]);
	this.keysPrivateExternal([]);
	this.keysAlreadyThere([]);

	this.keysForContact([]);
	this.keysNotForContact([]);

	this.keysBroken([]);

	this.keysChecked(false);

	this.shouldAddToPersonalContact(shouldAddToPersonalContact);
	this.contactEmail(contactEmail);
	this.contactUUID = contactUUID;
	this.fOnSuccessCallback = onSuccessCallback;

	if (this.keyArmor() !== '')
	{
		this.checkArmor();
	}
};

CImportKeyPopup.prototype.checkArmor = async function ()
{
	if (this.keyArmor() === '') {
		this.keyArmorFocused(true);
		return;
	}

	const keys = await OpenPgp.getArmorInfo(this.keyArmor());
	if (Types.isNonEmptyArray(keys)) {
		if (this.shouldAddToPersonalContact()) {
			this.checkArmorForContact(keys);
		} else {
			this.checkArmorForSettings(keys);
		}
		this.keysChecked(true);
	} else {
		Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_NO_KEY_FOUND'));
	}
};

function getKeyData(key) {
	const
		hasNoEmail = !AddressUtils.isCorrectEmail(key.getEmail()),
		hasSameKey = OpenPgp.findKeysByEmails([key.getEmail()], key.isPublic()).length > 0,
		isOwnKey = OpenPgp.isOwnEmail(key.getEmail()),
		addInfoLangKey = key.isPublic() ? '%MODULENAME%/INFO_PUBLIC_KEY_LENGTH' : '%MODULENAME%/INFO_PRIVATE_KEY_LENGTH'
	;
	return {
		'armor': key.getArmor(),
		'email': key.user,
		'id': `${key.getId()}_${key.isPublic() ? 'public': 'private'}`,
		'addInfo': TextUtils.i18n(addInfoLangKey, {'LENGTH': key.getBitSize()}),
		'needToImport': ko.observable(!hasSameKey && !hasNoEmail),
		'isExternal': !isOwnKey
	};
}

CImportKeyPopup.prototype.checkArmorForSettings = function (keys)
{
	const
		keysOwn = [],
		keysPublicExternal = [],
		keysPrivateExternal = [],
		keysAlreadyThere = [],
		keysBroken = []
	;

	keys.forEach(key => {
		const
			hasNoEmail = !AddressUtils.isCorrectEmail(key.getEmail()),
			hasSameKey = OpenPgp.findKeysByEmails([key.getEmail()], key.isPublic()).length > 0,
			isOwnKey = OpenPgp.isOwnEmail(key.getEmail()),
			keyData = getKeyData(key)
		;
		if (hasNoEmail) {
			keysBroken.push(keyData);
		} else if (hasSameKey) {
			keysAlreadyThere.push(keyData);
		} else if (isOwnKey) {
			keysOwn.push(keyData);
		} else {
			if (key.isPublic()) {
				keysPublicExternal.push(keyData);
			} else {
				keysPrivateExternal.push(keyData);
			}
		}
	});

	this.keysBroken(keysBroken);
	this.keysAlreadyThere(keysAlreadyThere);
	this.keysOwn(keysOwn);
	this.keysPublicExternal(keysPublicExternal);
	this.keysPrivateExternal(keysPrivateExternal);
};

CImportKeyPopup.prototype.checkArmorForContact = function (keys)
{
	const
		keysBroken = [],
		keysNotForContact = [],
		keysForContact = []
	;

	keys.forEach(key => {
		const
			hasNoEmail = !AddressUtils.isCorrectEmail(key.getEmail()),
			keyData = getKeyData(key)
		;
		if (hasNoEmail) {
			keysBroken.push(keyData);
		} else if (
			this.shouldAddToPersonalContact() && key.isPublic()
			&& (key.getEmail() === this.contactEmail() || this.contactEmail() === '')
		) {
			keysForContact.push(keyData);
		} else {
			keysNotForContact.push(keyData);
		}
	});
	this.keysBroken(keysBroken);
	this.keysNotForContact(keysNotForContact);
	this.keysForContact(keysForContact);
	if (keysForContact.length > 0) {
		this.selectedKeyForContact(keysForContact[0].id);
	}
};

CImportKeyPopup.prototype.getKeysDataForImport = function ()
{
	if (this.shouldAddToPersonalContact()) {
		return this.keysForContact()
				.filter(keyData => keyData.id === this.selectedKeyForContact());
	} else {
		return [...this.keysOwn(), ...this.keysPublicExternal()]
				.filter(keyData => keyData.needToImport());
	}
};

CImportKeyPopup.prototype.importKey = async function ()
{
	const armors = this.getKeysDataForImport().map(keyData => keyData.armor);

	if (armors.length > 0) {
		let res = null;
		if (this.shouldAddToPersonalContact()) {
			res = await OpenPgp.addKeyToContact(armors[0], this.contactUUID);
		} else {
			res = await OpenPgp.importKeys(armors.join(''));
		}

		if (res && res.result) {
			if (this.contactUUID) {
				Screens.showReport(TextUtils.i18n('%MODULENAME%/REPORT_KEY_SUCCESSFULLY_IMPORTED_PLURAL', {}, null, armors.length));
			}
			if (_.isFunction(this.fOnSuccessCallback)) {
				this.fOnSuccessCallback(armors[0]);
			}
		} else {
			if (res) {
				ErrorsUtils.showPgpErrorByCode(res, Enums.PgpAction.Import, TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_KEY'));
			} else {
				Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_KEY'));
			}
		}

		this.closePopup();
	} else {
		Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_NO_KEY_SELECTED'));
	}
};

module.exports = new CImportKeyPopup();
