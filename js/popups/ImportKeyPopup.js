'use strict';

var
	_ = require('underscore'),
	ko = require('knockout'),

	AddressUtils = require('%PathToCoreWebclientModule%/js/utils/Address.js'),
	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
	Types = require('%PathToCoreWebclientModule%/js/utils/Types.js'),

	App = require('%PathToCoreWebclientModule%/js/App.js'),
	CAbstractPopup = require('%PathToCoreWebclientModule%/js/popups/CAbstractPopup.js'),
	ModulesManager = require('%PathToCoreWebclientModule%/js/ModulesManager.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),

	ErrorsUtils = require('modules/%ModuleName%/js/utils/Errors.js'),

	Enums = require('modules/%ModuleName%/js/Enums.js'),
	OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js'),

	isTeamContactsAvailable = ModulesManager.isModuleAvailable('TeamContacts')
;

/**
 * @constructor
 */
function CImportKeyPopup()
{
	CAbstractPopup.call(this);

	this.teamContactsHasOwnKey = ko.computed(() => {
		return !!OpenPgp.ownKeyFromTeamContacts();
	});

	this.keyArmor = ko.observable('');
	this.keyArmorFocused = ko.observable(false);

	this.keysBroken = ko.observableArray([]);
	this.keysAlreadyThere = ko.observableArray([]);
	this.keysPrivateExternal = ko.observableArray([]);
	this.keysToImport = ko.observableArray([]);
	this.keysDisabledToImport = ko.observableArray([]);
	this.keysChecked = ko.observable(false);

	this.allowOnlyPublicKeyForEmail = ko.observable('');
	this.fOnSuccessCallback = null;
	
	this.disabledForContactHeading = ko.computed(function () {
		const langConst = '%MODULENAME%/INFO_TEXT_CONTAINS_NOT_PUBLIC_KEYS_OR_WITHOUT_EMAIL';
		return TextUtils.i18n(langConst, {'EMAIL': this.allowOnlyPublicKeyForEmail()});
	}, this);
}

_.extendOwn(CImportKeyPopup.prototype, CAbstractPopup.prototype);

CImportKeyPopup.prototype.PopupTemplate = '%ModuleName%_ImportKeyPopup';

/**
 * @param {string} armor
 * @param {function} onSuccessCallback
 * @param {string} allowOnlyPublicKeyForEmail
 */
CImportKeyPopup.prototype.onOpen = function ({ armor = '', onSuccessCallback = () => {},
	allowOnlyPublicKeyForEmail = '', isOwnContact = false })
{
	this.keyArmor(armor);
	this.keyArmorFocused(true);

	this.keysBroken([]);
	this.keysAlreadyThere([]);
	this.keysPrivateExternal([]);
	this.keysToImport([]);
	this.keysChecked(false);

	this.allowOnlyPublicKeyForEmail(allowOnlyPublicKeyForEmail);
	this.isOwnContact = isOwnContact;
	this.fOnSuccessCallback = onSuccessCallback;

	if (this.keyArmor() !== '')
	{
		this.checkArmor();
	}
};

CImportKeyPopup.prototype.checkArmor = async function ()
{
	var
		aRes = null,
		aKeysBroken = [],
		aKeysAlreadyThere = [],
		aKeysPrivateExternal = [],
		keysDisabledToImport = [],
		aKeysToImport = []
	;

	if (this.keyArmor() === '')
	{
		this.keyArmorFocused(true);
	}
	else
	{
		aRes = await OpenPgp.getArmorInfo(this.keyArmor());

		if (Types.isNonEmptyArray(aRes))
		{
			_.each(aRes, oKey => {
				if (oKey)
				{
					var
						aSameKeys = OpenPgp.findKeysByEmails([oKey.getEmail()], oKey.isPublic()),
						bHasSameKey = aSameKeys.length > 0,
						sAddInfoLangKey = oKey.isPublic() ? '%MODULENAME%/INFO_PUBLIC_KEY_LENGTH' : '%MODULENAME%/INFO_PRIVATE_KEY_LENGTH',
						bNoEmail = !AddressUtils.isCorrectEmail(oKey.getEmail())
					;
					var oKeyData = {
						'armor': oKey.getArmor(),
						'email': oKey.user,
						'id': oKey.getId(),
						'addInfo': TextUtils.i18n(sAddInfoLangKey, {'LENGTH': oKey.getBitSize()}),
						'needToImport': ko.observable(!bHasSameKey && !bNoEmail),
						'isExternal': !OpenPgp.isOwnEmail(oKey.getEmail()),
						'isOwn': isTeamContactsAvailable && oKey.getEmail() === App.getUserPublicId()
					};
					if (bNoEmail)
					{
						aKeysBroken.push(oKeyData);
					}
					else if (bHasSameKey)
					{
						aKeysAlreadyThere.push(oKeyData);
					}
					else if (this.allowOnlyPublicKeyForEmail() !== '' &&
							(this.allowOnlyPublicKeyForEmail() !== oKey.getEmail() || !oKey.isPublic())
					) {
						keysDisabledToImport.push(oKeyData);
					}
					else if (!oKey.isPublic() && !OpenPgp.isOwnEmail(oKey.getEmail()))
					{
						aKeysPrivateExternal.push(oKeyData);
					}
					else
					{
						aKeysToImport.push(oKeyData);
					}
				}
			});
		}

		if (aKeysBroken.length > 0 || aKeysAlreadyThere.length > 0 || aKeysPrivateExternal.length > 0 ||
				keysDisabledToImport.length > 0 || aKeysToImport.length > 0
		) {
			this.keysBroken(aKeysBroken);
			this.keysAlreadyThere(aKeysAlreadyThere);
			this.keysPrivateExternal(aKeysPrivateExternal);
			this.keysDisabledToImport(keysDisabledToImport);
			this.keysToImport(aKeysToImport);
			this.keysChecked(true);
		}
		else
		{
			Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_NO_KEY_FOUND'));
		}
	}
};

CImportKeyPopup.prototype.importKey = async function ()
{
	var
		oRes = null,
		aArmors = []
	;

	_.each(this.keysToImport(), oSimpleKey => {
		if (oSimpleKey.needToImport())
		{
			aArmors.push(oSimpleKey.armor);
		}
	});

	if (aArmors.length > 0)
	{
		if (this.allowOnlyPublicKeyForEmail() !== '' && aArmors.length === 1) {
			oRes = await OpenPgp.addKeyToContact(aArmors[0], this.isOwnContact);
		} else {
			oRes = await OpenPgp.importKeys(aArmors.join(''));
		}

		if (oRes && oRes.result)
		{
			Screens.showReport(TextUtils.i18n('%MODULENAME%/REPORT_KEY_SUCCESSFULLY_IMPORTED_PLURAL', {}, null, aArmors.length));
			if (_.isFunction(this.fOnSuccessCallback))
			{
				this.fOnSuccessCallback(aArmors[0]);
			}
		}

		if (oRes && !oRes.result)
		{
			ErrorsUtils.showPgpErrorByCode(oRes, Enums.PgpAction.Import, TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_KEY'));
		}

		this.closePopup();
	}
	else
	{
		Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_NO_KEY_SELECTED'));
	}
};

CImportKeyPopup.prototype.saveOwnKeyToTeamContact = async function (armor) {
	const res = await OpenPgp.addKeyToContact(armor, true);
	if (res && res.result) {
		Screens.showReport(TextUtils.i18n('%MODULENAME%/REPORT_KEY_SUCCESSFULLY_IMPORTED_PLURAL', {}, null, 1));
	} else {
		ErrorsUtils.showPgpErrorByCode(res, Enums.PgpAction.Import, TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_KEY'));
	}
};

module.exports = new CImportKeyPopup();
