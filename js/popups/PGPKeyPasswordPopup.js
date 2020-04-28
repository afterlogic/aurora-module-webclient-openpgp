'use strict';

var
	_ = require('underscore'),
	ko = require('knockout'),

	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
	CAbstractPopup = require('%PathToCoreWebclientModule%/js/popups/CAbstractPopup.js')
;

/**
 * @constructor
 */
function PGPKeyPasswordPopup()
{
	CAbstractPopup.call(this);

	this.keyPassword = ko.observable('');
	this.fOnPasswordEnterCallback = null;
	this.fOnCancellCallback = null;
	this.sHintText = ko.observable('');
}

_.extendOwn(PGPKeyPasswordPopup.prototype, CAbstractPopup.prototype);

PGPKeyPasswordPopup.prototype.PopupTemplate = '%ModuleName%_PGPKeyPasswordPopup';

PGPKeyPasswordPopup.prototype.onOpen = function (sKeyName, fOnPasswordEnterCallback, fOnCancellCallback)
{
	this.sHintText(TextUtils.i18n(
		'%MODULENAME%/LABEL_ENTER_YOUR_PASSWORD',
		{'KEY': sKeyName}
	));
	this.fOnPasswordEnterCallback = fOnPasswordEnterCallback;
	this.fOnCancellCallback = fOnCancellCallback;
};

PGPKeyPasswordPopup.prototype.enterPassword = function ()
{
	if (_.isFunction(this.fOnPasswordEnterCallback))
	{
		this.fOnPasswordEnterCallback(this.keyPassword());
	}
	this.closePopup();
};

PGPKeyPasswordPopup.prototype.cancelPopup = function ()
{
	if (_.isFunction(this.fOnCancellCallback))
	{
		this.fOnCancellCallback();
	}
	this.closePopup();
};

PGPKeyPasswordPopup.prototype.onShow = function ()
{
	this.keyPassword('');
};

module.exports = new PGPKeyPasswordPopup();
