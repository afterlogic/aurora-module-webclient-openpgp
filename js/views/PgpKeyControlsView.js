'use strict';

const
	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),

	ConfirmPopup = require('%PathToCoreWebclientModule%/js/popups/ConfirmPopup.js'),
	Popups = require('%PathToCoreWebclientModule%/js/Popups.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),

	OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js'),
	ShowKeyArmorPopup = require('modules/%ModuleName%/js/popups/ShowKeyArmorPopup.js')
;

function CPgpKeyControlsView()
{
}

CPgpKeyControlsView.prototype.ViewTemplate = '%ModuleName%_PgpKeyControlsView';

const prepareKey = async function (key, email, uuid)
{
	if (typeof key === 'string') {
		const keys = await OpenPgp.getKeysFromArmors([{
			Email: email,
			PublicPgpKey: key,
			UUID: uuid
		}]);
		return (keys.length === 1) ? keys[0] : null;
	}
	return key;
};

CPgpKeyControlsView.prototype.showArmor = async function (key, email, uuid)
{
	const preparedKey = await prepareKey(key, email, uuid);
	if (preparedKey) {
		Popups.showPopup(ShowKeyArmorPopup, [preparedKey]);
	}
};

CPgpKeyControlsView.prototype.setAfterRemoveContactKeyHandler = function (afterRemoveContactKeyHandler)
{
	this.afterRemoveContactKeyHandler = typeof afterRemoveContactKeyHandler === 'function' ? afterRemoveContactKeyHandler : () => {};
};

CPgpKeyControlsView.prototype.removeKeyFromContacts = async function (key, email, uuid)
{
	this.removeKey(key, email, uuid, 'removeKeyFromContacts');
};

CPgpKeyControlsView.prototype.removeKeyFromThisDevice = async function (key, email, uuid)
{
	this.removeKey(key, email, uuid, 'removeKeyFromThisDevice');
};

CPgpKeyControlsView.prototype.removeKey = async function (key, email, uuid, removeMethodName)
{
	const preparedKey = await prepareKey(key, email, uuid);
	const removeHandler = async isRemoveConfirmed => {
		if (isRemoveConfirmed) {
			const removeKeyResult = await OpenPgp[removeMethodName](preparedKey);
			if (!removeKeyResult.result) {
				Screens.showError(TextUtils.i18n('%MODULENAME%/ERROR_DELETE_KEY'));
			} else {
				this.afterRemoveContactKeyHandler();
			}
		}
	};
	const confirmText = TextUtils.i18n('%MODULENAME%/CONFIRM_DELETE_KEY', {'KEYEMAIL': preparedKey.getEmail()});
	Popups.showPopup(ConfirmPopup, [confirmText, removeHandler]);
};

module.exports = new CPgpKeyControlsView();
