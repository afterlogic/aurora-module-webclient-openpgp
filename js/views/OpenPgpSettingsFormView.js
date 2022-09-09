'use strict';

const
	_ = require('underscore'),
	ko = require('knockout'),

	ModulesManager = require('%PathToCoreWebclientModule%/js/ModulesManager.js'),

	CAbstractSettingsFormView = ModulesManager.run('SettingsWebclient', 'getAbstractSettingsFormViewClass'),

	Popups = require('%PathToCoreWebclientModule%/js/Popups.js'),
	GenerateKeyPopup = require('modules/%ModuleName%/js/popups/GenerateKeyPopup.js'),
	ImportKeyPopup = require('modules/%ModuleName%/js/popups/ImportKeyPopup.js'),
	ShowPublicKeysArmorPopup = require('modules/%ModuleName%/js/popups/ShowPublicKeysArmorPopup.js'),
	VerifyPasswordPopup = require('modules/%ModuleName%/js/popups/VerifyPasswordPopup.js'),

	OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js'),
	Settings = require('modules/%ModuleName%/js/Settings.js')
;

/**
 * @constructor
 */
function COpenPgpSettingsFormView()
{
	CAbstractSettingsFormView.call(this, Settings.ServerModuleName);

	this.enableOpenPgpInMail = ko.observable(Settings.enableOpenPgpInMail());
	this.rememberPassphrase = Settings.rememberPassphrase;
	this.isMailAvailable = ModulesManager.isModuleAvailable('Mail');

	this.keys = ko.observableArray(OpenPgp.getKeys());
	OpenPgp.getKeysObservable().subscribe(function () {
		this.keys(OpenPgp.getKeys());
	}, this);

	this.publicKeys = ko.computed(function () {
		var
			aPublicKeys = _.filter(this.keys(), function (oKey) {
				return oKey.isPublic() && !oKey.isExternal;
			})
		;
		return _.map(aPublicKeys, function (oKey) {
			return {'user': oKey.getUser(), 'armor': oKey.getArmor(), 'key': oKey, 'private': false};
		});
	}, this);
	this.privateKeys = ko.computed(function () {
		var
			aPrivateKeys = _.filter(this.keys(), function (oKey) {
				return oKey.isPrivate()&&!oKey.isExternal;
			})
		;
		return  _.map(aPrivateKeys, function (oKey) {
			return {'user': oKey.getUser(), 'armor': oKey.getArmor(), 'key': oKey};
		});
	}, this);
	this.externalPublicKeys = ko.computed(function () {
		var
			aPublicKeys = _.filter(this.keys(), function (oKey) {
				return oKey.isPublic() && oKey.isExternal;
			})
		;
		return _.map(aPublicKeys, function (oKey) {
			return {'user': oKey.getUser(), 'armor': oKey.getArmor(), 'key': oKey, 'private': false};
		});
	}, this);

	this.oPgpKeyControlsView = ModulesManager.run('OpenPgpWebclient', 'getPgpKeyControlsView');
}

_.extendOwn(COpenPgpSettingsFormView.prototype, CAbstractSettingsFormView.prototype);

COpenPgpSettingsFormView.prototype.ViewTemplate = '%ModuleName%_OpenPgpSettingsFormView';

COpenPgpSettingsFormView.prototype.exportAllPublicKeys = function ()
{
	var
		aArmors = _.map(_.union(this.publicKeys(), this.externalPublicKeys()), function (oKey) {
			return oKey.armor;
		})
	;

	if (aArmors.length > 0)
	{
		Popups.showPopup(ShowPublicKeysArmorPopup, [aArmors.join('\n')]);
	}
};

COpenPgpSettingsFormView.prototype.importKey = function ()
{
	Popups.showPopup(ImportKeyPopup);
};

COpenPgpSettingsFormView.prototype.generateNewKey = function ()
{
	Popups.showPopup(GenerateKeyPopup);
};

/**
 * @param {Object} key
 */
COpenPgpSettingsFormView.prototype.removeOpenPgpKey = function (key)
{
	this.oPgpKeyControlsView.removeOpenPgpKey(key);
};

/**
 * @param {Object} oKey
 */
COpenPgpSettingsFormView.prototype.verifyPassword = function (oKey)
{
	var fShowArmor = function () {
		this.showArmor(oKey);
	}.bind(this);

	Popups.showPopup(VerifyPasswordPopup, [oKey, fShowArmor]);
};

/**
 * @param {Object} key
 */
COpenPgpSettingsFormView.prototype.showArmor = function (key)
{
	this.oPgpKeyControlsView.showArmor(key);
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
