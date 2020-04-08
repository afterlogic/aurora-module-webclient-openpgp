'use strict';

function IsPgpSupported()
{
	return !!(window.crypto && window.crypto.getRandomValues);
}

module.exports = function (oAppData) {
	var
		Utils = require('%PathToCoreWebclientModule%/js/utils/Common.js'),
		App = require('%PathToCoreWebclientModule%/js/App.js'),
		Popups = require('%PathToCoreWebclientModule%/js/Popups.js'),
		ImportKeyPopup = null, // ImportKeyPopup requires the OpenPGP library, so it should be required after verifying PGP support only
		Ajax = require('%PathToCoreWebclientModule%/js/Ajax.js')
	;

	if (App.isUserNormalOrTenant())
	{
		var
			_ = require('underscore'),

			TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),

			Settings = require('modules/%ModuleName%/js/Settings.js')
		;

		Settings.init(oAppData);

		return {
			start: function (ModulesManager) {
				if (IsPgpSupported())
				{
					ImportKeyPopup = require('modules/%ModuleName%/js/popups/ImportKeyPopup.js');
					App.subscribeEvent('MailWebclient::RegisterMessagePaneController', function (fRegisterMessagePaneController) {
						fRegisterMessagePaneController(require('modules/%ModuleName%/js/views/MessageControlsView.js'), 'BeforeMessageHeaders');
					});
					if (App.isMobile())
					{
						ModulesManager.run('MailMobileWebclient', 'registerComposeToolbarController', [require('modules/%ModuleName%/js/views/ComposeButtonsView.js')]);
					}
					else
					{
						ModulesManager.run('MailWebclient', 'registerComposeToolbarController', [require('modules/%ModuleName%/js/views/ComposeButtonsView.js')]);
					}
					ModulesManager.run('SettingsWebclient', 'registerSettingsTab', [function () { return require('modules/%ModuleName%/js/views/OpenPgpSettingsFormView.js'); }, Settings.HashModuleName, TextUtils.i18n('%MODULENAME%/LABEL_SETTINGS_TAB')]);

					App.subscribeEvent('MailWebclient::ParseFile::after', function (oFile) {
						if (oFile && _.isFunction(oFile.addAction) && Utils.getFileExtension(oFile.fileName()) === 'asc' && oFile.content && oFile.content())
						{
							var
								OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js'),
								SendKeyPopup = require('modules/%ModuleName%/js/popups/SendKeyPopup.js'),
								fOnSuccessCallback = () => {
									if (oFile.folderName() && oFile.messageUid())
									{
										const sUserEmail = App.currentAccountEmail ? App.currentAccountEmail() : '';
										const aKeys = OpenPgp.getPublicKeysIfExistsByEmail(sUserEmail);
										if (aKeys && aKeys[0])
										{
											ModulesManager.run(
												'MailWebclient',
												'getMessage',
												[
													oFile.folderName(),
													oFile.messageUid(),
													oMessage => {
														Popups.showPopup(SendKeyPopup, [oMessage, aKeys[0]]);
													}
												]
											);
										}
									}
								},
								oActionData = {
									'Text': TextUtils.i18n('%MODULENAME%/ACTION_FILE_IMPORT_KEY'),
									'Handler': function () { Popups.showPopup(ImportKeyPopup, [oFile.content(), fOnSuccessCallback]); }
								}
							;
							oFile.addAction('import', true, oActionData);
							oFile.removeAction('view');
						}
					});

					App.subscribeEvent('FilesWebclient::ParseFile::after', function (aParams) {
						var
							oFile = aParams[0]
						;
						if (oFile && _.isFunction(oFile.addAction) && Utils.getFileExtension(oFile.fileName()) === 'asc' && oFile.content && oFile.content())
						{
							var oActionData = {
								'Text': TextUtils.i18n('%MODULENAME%/ACTION_FILE_IMPORT_KEY'),
								'Handler': () => { Popups.showPopup(ImportKeyPopup, [oFile.content()]); }
							};
							oFile.addAction('import', true, oActionData);
						}
					});

					let createOrUpdateContactResult = async oParams => {
						let
							oContact = oParams.Contact,
							fCallback = oParams.Callback,
							oKey = null,
							oResult = {Error: false, ErrorMessage: ''}
						;

						if (oContact.PublicPgpKey != '')
						{
							oKey = await this.getKeyInfo(oContact.PublicPgpKey);
							if (oKey)
							{
								if (oKey.getEmail() !== oContact.ViewEmail)
								{
									oResult.Error = true;
									oResult.ErrorMessage = TextUtils.i18n('%MODULENAME%/ERROR_EMAILS_DO_NOT_MATCH');
								}
							}
							else
							{
								oResult.Error = true;
								oResult.ErrorMessage = TextUtils.i18n('%MODULENAME%/ERROR_IMPORT_NO_KEY_FOUND');
							}
						}

						fCallback(oResult);
					};

					if (this.isOpenPgpEnabled())
					{
						App.subscribeEvent('ContactsWebclient::beforeCreateContactRequest', createOrUpdateContactResult);
						App.subscribeEvent('ContactsWebclient::beforeUpdateContactRequest', createOrUpdateContactResult);
					}

					App.subscribeEvent('%ModuleName%::reloadKeysFromStorage', aParams => {
						let
							fCallback = aParams[0],
							aKeys = []
						;

						Ajax.send('%ModuleName%', 'GetPublicKeysFromContacts', {}, async oResponse => {
							let
								result = oResponse && oResponse.Result
							;
							for (let key of result)
							{
								let oKey = await this.getKeyInfo(key.PublicPgpKey);
								if (oKey)
								{
									oKey.isExternal = true;
									aKeys.push(oKey);
								}
							}
							fCallback(aKeys);
						}, this);
					});
				}
			},

			isOpenPgpEnabled: () =>
			{
				if (!IsPgpSupported())
				{
					Settings.enableOpenPgp(false);
				}
				return Settings.enableOpenPgp;
			},

			getKeyInfo: async Value =>
			{
				var
					openpgp = require('%PathToCoreWebclientModule%/js/vendors/openpgp.js'),
					COpenPgpKey = require('modules/OpenPgpWebclient/js/COpenPgpKey.js'),
					oPublicKey = null,
					oResult = null
				;

				oPublicKey = await openpgp.key.readArmored(Value);
				if (oPublicKey && !oPublicKey.err && oPublicKey.keys && oPublicKey.keys[0])
				{
					oResult = new COpenPgpKey(oPublicKey.keys[0]);
				}

				return oResult;
			},

			importExternalKeys: (aKeys, fCallback) =>
			{
				let
					aKeysParam = []
				;
				for (let oKey of aKeys)
				{
					aKeysParam.push(
						{
							'Email': oKey.getEmail(),
							'Key': oKey.getArmor()
						}
					);
				}
				Ajax.send('%ModuleName%', 'AddPublicKeysToContacts', {'Keys': aKeysParam}, oResponse => {
					if (oResponse && oResponse.Result)
					{
						fCallback(oResponse.Result);
					}
				}, this);
			},

			deleteExternalKey: (oKey, fCallback) =>
			{
				Ajax.send('%ModuleName%', 'RemovePublicKeyFromContact', {'Email': oKey.getEmail()}, oResponse => {
					if (oResponse && oResponse.Result)
					{
						fCallback(oResponse.Result);
					}
				}, this);
			}
		};
	}

	return null;
};
