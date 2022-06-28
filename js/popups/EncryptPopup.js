'use strict';

var
	_ = require('underscore'),
	ko = require('knockout'),

	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
	Utils = require('%PathToCoreWebclientModule%/js/utils/Common.js'),

	Ajax = require('%PathToCoreWebclientModule%/js/Ajax.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),

	CAbstractPopup = require('%PathToCoreWebclientModule%/js/popups/CAbstractPopup.js'),

	ErrorsUtils = require('modules/%ModuleName%/js/utils/Errors.js'),

	Enums = require('modules/%ModuleName%/js/Enums.js'),
	OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js')
;

/**
 * @constructor
 */
function CEncryptPopup()
{
	CAbstractPopup.call(this);

	this.data = ko.observable('');
	this.fromEmail = ko.observable('');
	this.emails = ko.observableArray([]);
	this.contactsUUIDs = [];
	this.successEncryptCallback = () => {};
	this.needToSign = ko.observable(true);
	this.needToEncrypt = ko.observable(true);
	this.signEncryptButtonText = ko.computed(function () {
		let text = TextUtils.i18n('%MODULENAME%/ACTION_SIGN_ENCRYPT');
		if (this.needToSign() && !this.needToEncrypt()) {
			text = TextUtils.i18n('%MODULENAME%/ACTION_SIGN');
		}
		if (!this.needToSign() && this.needToEncrypt()) {
			text = TextUtils.i18n('%MODULENAME%/ACTION_ENCRYPT');
		}
		return text;
	}, this);
	this.isEnableSignEncrypt = ko.computed(function () {
		return this.needToSign() || this.needToEncrypt();
	}, this);
	this.signEncryptCommand = Utils.createCommand(this, this.executeSignEncrypt, this.isEnableSignEncrypt);
}

_.extendOwn(CEncryptPopup.prototype, CAbstractPopup.prototype);

CEncryptPopup.prototype.PopupTemplate = '%ModuleName%_EncryptPopup';

/**
 * @param {string} dataToEncrypt
 * @param {string} fromEmail
 * @param {array} resipientsInfo
 * @param {function} successEncryptCallback
 */
CEncryptPopup.prototype.onOpen = function (dataToEncrypt, fromEmail, resipientsInfo, successEncryptCallback)
{
	this.data(dataToEncrypt);
	this.fromEmail(fromEmail);
	this.emails(resipientsInfo.map(info => info.email));
	this.contactsUUIDs = resipientsInfo.map(info => info.uuid);
	this.successEncryptCallback = _.isFunction(successEncryptCallback) ? successEncryptCallback : () => {};
	this.needToSign(true);
	this.needToEncrypt(true);
};

CEncryptPopup.prototype.executeSignEncrypt = function ()
{
	const
		dataToEncrypt = this.data(),
		privateEmail = this.needToSign() ? this.fromEmail() : '',
		successHandler = encryptResult => {
			Screens.showReport(okReport);
			this.closePopup();
			this.successEncryptCallback(encryptResult.result, this.needToEncrypt());
		},
		errorHandler = encryptResult => {
			if (!encryptResult || !encryptResult.userCanceled) {
				ErrorsUtils.showPgpErrorByCode(encryptResult, pgpAction);
			}
		}
	;

	let
		okReport = '',
		pgpAction = ''
	;
	if (this.needToEncrypt()) {
		if (this.emails().length === 0) {
			Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_TO_ENCRYPT_SPECIFY_RECIPIENTS'));
		} else {
			const
				userEmails = [this.fromEmail()],
				userPublicKeys = OpenPgp.findKeysByEmails(userEmails, true),
				principalsEmails = userPublicKeys.length > 0
					? _.union(this.emails(), userEmails)
					: this.emails()
			;
			if (this.needToSign()) {
				pgpAction = Enums.PgpAction.EncryptSign;
				okReport = TextUtils.i18n('%MODULENAME%/REPORT_MESSAGE_SIGNED_ENCRYPTED_SUCCSESSFULLY');
				OpenPgp.signAndEncrypt(dataToEncrypt, privateEmail, principalsEmails, '', successHandler,
					errorHandler, this.contactsUUIDs
				);
			} else {
				pgpAction = Enums.PgpAction.Encrypt;
				okReport = TextUtils.i18n('%MODULENAME%/REPORT_MESSAGE_ENCRYPTED_SUCCSESSFULLY');
				OpenPgp.encrypt(dataToEncrypt, principalsEmails, successHandler, errorHandler,
					this.contactsUUIDs
				);
			}
		}
	} else if (this.needToSign()) {
		pgpAction = Enums.PgpAction.Sign;
		okReport = TextUtils.i18n('%MODULENAME%/REPORT_MESSAGE_SIGNED_SUCCSESSFULLY');
		OpenPgp.sign(dataToEncrypt, privateEmail, successHandler, errorHandler, '');
	}
};

CEncryptPopup.prototype.cancelPopup = function ()
{
	this.closePopup();
};

module.exports = new CEncryptPopup();
