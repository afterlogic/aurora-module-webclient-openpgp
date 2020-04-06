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

					App.subscribeEvent('%ModuleName%::reloadKeysFromStorage', aParams => {
						let
							keys = aParams[0],
							openpgp = require('%PathToCoreWebclientModule%/js/vendors/openpgp.js'),
							COpenPgpKey = require('modules/%ModuleName%/js/COpenPgpKey.js')
						;

						Ajax.send('%ModuleName%', 'GetPublicKeysFromContacts', {}, async oResponse => {
							let
								result = oResponse && oResponse.Result,
								oPublicKey = null
							;
							for (let key of result)
							{
								oPublicKey = await openpgp.key.readArmored(key.PublicPgpKey);
								if (oPublicKey && !oPublicKey.err && oPublicKey.keys && oPublicKey.keys[0])
								{
									let oKey = new COpenPgpKey(oPublicKey.keys[0]);
									oKey.isExternal = true;
									keys.push(oKey);
								}								
							}
						}, this);						
					});			
					
					App.subscribeEvent('%ModuleName%::deleteExternalKey', aParams => {
						let 
							key = aParams[0],
							OpenPgpObject = aParams[1]
						;

						Ajax.send('%ModuleName%', 'RemovePublicKeyFromContact', {'Email': key.getEmail()}, oResponse => {
							if (oResponse && oResponse.Result)
							{
								OpenPgpObject.reloadKeysFromStorage();
							}							
						}, this);						
					});
					
					App.subscribeEvent('%ModuleName%::importExternalKey', aParams => {
						let 
							key = aParams[0],
							OpenPgpObject = aParams[1]
						;

						Ajax.send('%ModuleName%', 'AddPublicKeyToContact', {'Email': key.getEmail(), 'Key': key.getArmor()}, oResponse => {
							if (oResponse && oResponse.Result)
							{
								OpenPgpObject.reloadKeysFromStorage();
							}
						}, this);						
					});						
				}
			}
		};
	}

	return null;
};
