'use strict';

function IsPgpSupported()
{
	return !!(window.crypto && window.crypto.getRandomValues);
}

module.exports = function (oAppData) {
	if (!IsPgpSupported())
	{
		return null;
	}

	let
		Utils = require('%PathToCoreWebclientModule%/js/utils/Common.js'),
		App = require('%PathToCoreWebclientModule%/js/App.js'),
		Popups = require('%PathToCoreWebclientModule%/js/Popups.js'),
		ImportKeyPopup = null, // ImportKeyPopup requires the OpenPGP library, so it should be required after verifying PGP support only
		Ajax = require('%PathToCoreWebclientModule%/js/Ajax.js')
	;

	if (App.isUserNormalOrTenant())
	{
		let
			_ = require('underscore'),
			TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
			Settings = require('modules/%ModuleName%/js/Settings.js')
		;

		Settings.init(oAppData);

		return {
			start(ModulesManager)
			{
				ImportKeyPopup = require('modules/%ModuleName%/js/popups/ImportKeyPopup.js');
				App.subscribeEvent(
					'MailWebclient::RegisterMessagePaneController',
					fRegisterMessagePaneController => {
						fRegisterMessagePaneController(
							require('modules/%ModuleName%/js/views/MessageControlsView.js'),
							'BeforeMessageHeaders'
						);
					}
				);
				if (App.isMobile())
				{
					ModulesManager.run(
						'MailMobileWebclient',
						'registerComposeToolbarController',
						[ require('modules/%ModuleName%/js/views/ComposeButtonsView.js') ]
					);
				}
				else
				{
					ModulesManager.run(
						'MailWebclient',
						'registerComposeToolbarController',
						[ require('modules/%ModuleName%/js/views/ComposeButtonsView.js') ]
					);
				}
				ModulesManager.run(
					'SettingsWebclient',
					'registerSettingsTab',
					[
						() => require('modules/%ModuleName%/js/views/OpenPgpSettingsFormView.js'),
						Settings.HashModuleName, TextUtils.i18n('%MODULENAME%/LABEL_SETTINGS_TAB')
					]
				);

				App.subscribeEvent(
					'MailWebclient::ParseFile::after',
					oFile => {
						if (
							oFile
							&& _.isFunction(oFile.addAction)
							&& Utils.getFileExtension(oFile.fileName()) === 'asc'
							&& oFile.content && oFile.content()
						)
						{
							let
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
									'Handler': () => {
										Popups.showPopup(
											ImportKeyPopup,
											[
												oFile.content(),
												fOnSuccessCallback
											]
										);
									}
								}
							;
							oFile.addAction('import', true, oActionData);
							oFile.removeAction('view');
						}
					}
				);

				App.subscribeEvent(
					'FilesWebclient::ParseFile::after',
					aParams => {
						let oFile = aParams[0];
						if (
							oFile
							&& _.isFunction(oFile.addAction)
							&& Utils.getFileExtension(oFile.fileName()) === 'asc'
							&& oFile.content && oFile.content()
						)
						{
							let oActionData = {
								'Text': TextUtils.i18n('%MODULENAME%/ACTION_FILE_IMPORT_KEY'),
								'Handler': () => {
									Popups.showPopup(
										ImportKeyPopup,
										[ oFile.content() ]
									);
								}
							};
							oFile.addAction('import', true, oActionData);
						}
					}
				);

				let createOrUpdateContactResult = async oParams => {
					let
						oContact = oParams.Contact,
						fCallback = oParams.Callback,
						oKey = null,
						oResult = { Error: false, ErrorMessage: '' }
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

				if (Settings.enableOpenPgp())
				{
					App.subscribeEvent('ContactsWebclient::beforeCreateContactRequest', createOrUpdateContactResult);
					App.subscribeEvent('ContactsWebclient::beforeUpdateContactRequest', createOrUpdateContactResult);
				}
			},

			isOpenPgpEnabled()
			{
				return Settings.enableOpenPgp;
			},

			async getKeyInfo(sValue, fCallback)
			{
				let
					openpgp = require('%PathToCoreWebclientModule%/js/vendors/openpgp.js'),
					COpenPgpKey = require('modules/OpenPgpWebclient/js/COpenPgpKey.js'),
					oPublicKey = null,
					oResult = null
				;

				oPublicKey = await openpgp.key.readArmored(sValue);
				if (
					oPublicKey
					&& !oPublicKey.err
					&& oPublicKey.keys
					&& oPublicKey.keys[0]
				)
				{
					oResult = new COpenPgpKey(oPublicKey.keys[0]);
				}
				if (_.isFunction(fCallback))
				{
					fCallback(oResult);
				}

				return oResult;
			},

			deleteExternalKey(oKey, fCallback)
			{
				Ajax.send(
					'%ModuleName%',
					'RemovePublicKeyFromContact',
					{ 'Email': oKey.getEmail() },
					oResponse => {
						if (oResponse && oResponse.Result)
						{
							fCallback(oResponse.Result);
						}
					},
					this
				);
			},

			getOpenPgpEncryptor()
			{
				let OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js');
				return OpenPgp;
			},

			getSuggestionsAutocompleteFilteredCallback(fSuggestionsAutocompleteCallback)
			{
				return (oRequest, fResponse) => {
					const fResponseWrapper = oItems => {
						/*---here we can filter or edit response items---*/
						let OpenPgp = require('modules/%ModuleName%/js/OpenPgp.js');
						const aPublicKeysEmails = OpenPgp.getPublicKeys().map(oKey => oKey.getEmail());
						oItems.forEach(oItem => {
							oItem.hasKey = aPublicKeysEmails.includes(oItem.email)
						});
						/*-----------------------------------------------*/
						fResponse(oItems);
					};
					fSuggestionsAutocompleteCallback(oRequest, fResponseWrapper)
				};
			}
		};
	}

	return null;
};
