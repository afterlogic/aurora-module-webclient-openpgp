'use strict';

const
	_ = require('underscore'),
	ko = require('knockout'),

	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),

	App = require('%PathToCoreWebclientModule%/js/App.js'),
	ModulesManager = require('%PathToCoreWebclientModule%/js/ModulesManager.js'),
	Popups = require('%PathToCoreWebclientModule%/js/Popups.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),

	CAbstractSettingsFormView = ModulesManager.run('SettingsWebclient', 'getAbstractSettingsFormViewClass'),

	ErrorsUtils = require('modules/%ModuleName%/js/utils/Errors.js'),

	GenerateKeyPopup = require('modules/%ModuleName%/js/popups/GenerateKeyPopup.js'),
	ImportKeyPopup = require('modules/%ModuleName%/js/popups/ImportKeyPopup.js'),
	OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js'),
	Settings = require('modules/%ModuleName%/js/Settings.js'),
	ShowPublicKeysArmorPopup = require('modules/%ModuleName%/js/popups/ShowPublicKeysArmorPopup.js'),
	VerifyPasswordPopup = require('modules/%ModuleName%/js/popups/VerifyPasswordPopup.js'),

	isTeamContactsAvailable = ModulesManager.isModuleAvailable('TeamContacts')
;

/**
 * @constructor
 */
function COpenPgpSettingsFormView()
{
	CAbstractSettingsFormView.call(this, Settings.ServerModuleName);

	this.bTeamContactsAvailable = isTeamContactsAvailable;
	this.enableOpenPgpInMail = ko.observable(Settings.enableOpenPgpInMail());
	this.rememberPassphrase = Settings.rememberPassphrase;
	this.isMailAvailable = ModulesManager.isModuleAvailable('Mail');

	this.keys = ko.observableArray(OpenPgp.getKeys());
	OpenPgp.getKeysObservable().subscribe(function () {
		this.keys(OpenPgp.getKeys());
	}, this);

	this.noOwnKeyInTeamContacts = ko.computed(() => {
		return OpenPgp.ownKeyFromTeamContacts() === false;
	});

	this.publicKeysFromThisDevice = ko.computed(function () {
		return this.keys()
				.filter(key => !key.isFromContacts && key.isPublic())
				.map(key => {
					const
						isOwn = isTeamContactsAvailable && key.getEmail() === App.getUserPublicId(),
						ownKeyFromTeamContacts = OpenPgp.ownKeyFromTeamContacts(),
						isSameKeyFromTeamContacts = isOwn && ownKeyFromTeamContacts && key.getId() === ownKeyFromTeamContacts.getId()
					;
					return {
						key,
						user: key.getUser(),
						isOwn,
						hasOwnKeyFromTeamContacts: !!ownKeyFromTeamContacts,
						isSameKeyFromTeamContacts
					};
				});
	}, this);
	this.privateKeysFromThisDevice = ko.computed(function () {
		return this.keys()
				.filter(key  => !key.isFromContacts && key.isPrivate())
				.map(key => ({
					key,
					user: key.getUser()
				}));
	}, this);
	this.keysFromPersonalContacts = ko.computed(function () {
		return this.keys()
				.filter(key  => key.isFromContacts)
				.map(key => ({
					key,
					user: key.getUser()
				}));
	}, this);

	this.oPgpKeyControlsView = ModulesManager.run('OpenPgpWebclient', 'getPgpKeyControlsView');
}

_.extendOwn(COpenPgpSettingsFormView.prototype, CAbstractSettingsFormView.prototype);

COpenPgpSettingsFormView.prototype.ViewTemplate = '%ModuleName%_OpenPgpSettingsFormView';

COpenPgpSettingsFormView.prototype.saveOwnKeyToTeamContact = async function (key) {
	const armor = key.getArmor();
	const res = await OpenPgp.addKeyToContact(armor, '', true);
	if (res && res.result) {
		Screens.showReport(TextUtils.i18n('%MODULENAME%/REPORT_KEY_SUCCESSFULLY_IMPORTED_PLURAL', {}, null, 1));
	} else {
		ErrorsUtils.showPgpErrorByCode(res, Enums.PgpAction.Import, TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_KEY'));
	}
};

COpenPgpSettingsFormView.prototype.exportAllPublicKeys = function ()
{
	const
		armors = _.map(_.union(this.publicKeysFromThisDevice(), this.keysFromPersonalContacts()), function (keyData) {
			return keyData.key.getArmor();
		})
	;

	if (armors.length > 0) {
		Popups.showPopup(ShowPublicKeysArmorPopup, [armors.join('\n')]);
	}
};

COpenPgpSettingsFormView.prototype.importKey = function ()
{
	Popups.showPopup(ImportKeyPopup, [{}]);
};

COpenPgpSettingsFormView.prototype.generateNewKey = function ()
{
	Popups.showPopup(GenerateKeyPopup);
};

COpenPgpSettingsFormView.prototype.removeKeyFromContacts = function (key)
{
	this.oPgpKeyControlsView.removeKeyFromContacts(key);
};

/**
 * @param {Object} key
 */
COpenPgpSettingsFormView.prototype.removeKeyFromThisDevice = function (key)
{
	this.oPgpKeyControlsView.removeKeyFromThisDevice(key);
};

/**
 * @param {Object} key
 */
COpenPgpSettingsFormView.prototype.showArmor = function (key)
{
	if (key.isPublic()) {
		this.oPgpKeyControlsView.showArmor(key);
	} else {
		Popups.showPopup(VerifyPasswordPopup, [key, () => { this.oPgpKeyControlsView.showArmor(key); }]);
	}
};

COpenPgpSettingsFormView.prototype.getCurrentValues = function ()
{
	return [
		this.enableOpenPgpInMail(),
		this.rememberPassphrase()
	];
};

COpenPgpSettingsFormView.prototype.revertGlobalValues = function ()
{
	this.enableOpenPgpInMail(Settings.enableOpenPgpInMail());
	this.rememberPassphrase(Settings.rememberPassphrase());
};

COpenPgpSettingsFormView.prototype.getParametersForSave = function ()
{
	return {
		'EnableModule': this.enableOpenPgpInMail(),
		'RememberPassphrase': this.rememberPassphrase()
	};
};

COpenPgpSettingsFormView.prototype.applySavedValues = function (oParameters)
{
	Settings.update(oParameters.EnableModule);
};

module.exports = new COpenPgpSettingsFormView();
