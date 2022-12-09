'use strict';

let
	_ = require('underscore'),
	$ = require('jquery'),
	ko = require('knockout'),

	AddressUtils = require('%PathToCoreWebclientModule%/js/utils/Address.js'),
	TextUtils = require('%PathToCoreWebclientModule%/js/utils/Text.js'),
	Types = require('%PathToCoreWebclientModule%/js/utils/Types.js'),

	openpgp = require('%PathToCoreWebclientModule%/js/vendors/openpgp.js'),
	Ajax = require('%PathToCoreWebclientModule%/js/Ajax.js'),
	App = require('%PathToCoreWebclientModule%/js/App.js'),
	ModulesManager = require('%PathToCoreWebclientModule%/js/ModulesManager.js'),
	Popups = require('%PathToCoreWebclientModule%/js/Popups.js'),
	Screens = require('%PathToCoreWebclientModule%/js/Screens.js'),

	ErrorsUtils = require('modules/%ModuleName%/js/utils/Errors.js'),

	COpenPgpKey = require('modules/%ModuleName%/js/COpenPgpKey.js'),
	COpenPgpResult = require('modules/%ModuleName%/js/COpenPgpResult.js'),
	Enums = require('modules/%ModuleName%/js/Enums.js'),
	PGPKeyPasswordPopup = require('modules/%ModuleName%/js/popups/PGPKeyPasswordPopup.js'),
	Settings = require('modules/%ModuleName%/js/Settings.js'),

	isTeamContactsAvailable = ModulesManager.isModuleAvailable('TeamContacts')
;

async function getKeysFromArmors (armorsData) {
	const openPgpKeys = [];
	for (let key of armorsData) {
		const nativeKey = await openpgp.key.readArmored(key.PublicPgpKey);
		if (nativeKey && !nativeKey.err && nativeKey.keys && nativeKey.keys[0]) {
			const openPgpKey = new COpenPgpKey(nativeKey.keys[0]);
			if (openPgpKey) {
				openPgpKey.isFromContacts = true;
				openPgpKeys.push(openPgpKey);
			}
		}
	}
	return openPgpKeys;
};

async function importExternalKeys (externalKeys)
{
	let addKeysPromise = new Promise((resolve, reject) => {
		const
			parameters = {
				Keys: externalKeys.map(key => ({
					Email: key.getEmail(),
					Key: key.getArmor(),
					Name: key.getUserName()
				}))
			},
			responseHandler = response => resolve(response && response.Result)
		;
		Ajax.send('%ModuleName%', 'AddPublicKeysToContacts', parameters, responseHandler);
	});
	return await addKeysPromise;
}

async function updateContactPublicKey (publicPgpKeyArmor, UUID)
{
	const updateOwnPublicKeyPromise = new Promise((resolve, reject) => {
		const
			parameters = {
				UUID,
				Key: publicPgpKeyArmor
			},
			responseHandler = response => resolve(response && response.Result)
		;
		Ajax.send('%ModuleName%', 'AddPublicKeyToContactWithUUID', parameters, responseHandler);
	});
	return await updateOwnPublicKeyPromise;
}

async function updateOwnContactPublicKey (publicPgpKeyArmor)
{
	const updateOwnPublicKeyPromise = new Promise((resolve, reject) => {
		const
			parameters = {
				PublicPgpKey: publicPgpKeyArmor
			},
			responseHandler = response => resolve(response && response.Result)
		;
		Ajax.send('%ModuleName%', 'UpdateOwnContactPublicKey', parameters, responseHandler);
	});
	return await updateOwnPublicKeyPromise;
}

async function getPublicKeysFromContacts ()
{
	return new Promise((resolve) => {
		const responseHandler = async response => {
			const armors = response && response.Result;
			if (Array.isArray(armors)) {
				const openPgpKeys = await getKeysFromArmors(armors);
				resolve(openPgpKeys);
			}
		};
		Ajax.send('%ModuleName%', 'GetPublicKeysFromContacts', {}, responseHandler);
	});
}

async function getOwnPublicKeyFromTeamContacts ()
{
	return new Promise((resolve, reject) => {
		if (isTeamContactsAvailable) {
			const responseHandler = async response => {
				const
					result = response && response.Result,
					armors = Types.isNonEmptyString(result)
						? [{
							Email: App.getUserPublicId(),
							PublicPgpKey: result
						}]
						: null
				;
				if (Array.isArray(armors)) {
					const openPgpKeys = await getKeysFromArmors(armors);
					resolve(openPgpKeys.length > 0 && openPgpKeys[0] || false);
				} else {
					resolve(false);
				}
			};
			Ajax.send('%ModuleName%', 'GetOwnContactPublicKey', {}, responseHandler);
		} else {
			resolve(null);
		}
	});
}

/**
 * @constructor
 */
function COpenPgp()
{
	this.oKeyring = new openpgp.Keyring(new openpgp.Keyring.localstore(`aurora_openpgp_user_${App.getUserId() || 0}_`));
	this.keys = ko.observableArray([]);
	this.ownKeyFromTeamContacts = ko.observable(null);
	this.oPromiseInitialised = this.initKeys();

	App.subscribeEvent('ContactsWebclient::createContactResponse', aParams => {
		let
			responseResult = aParams[0]
		;
		if (responseResult)
		{
			this.reloadKeysFromStorage();
		}
	});

	App.subscribeEvent('ContactsWebclient::updateContactResponse', aParams => {
		let
			responseResult = aParams[0]
		;
		if (responseResult)
		{
			this.reloadKeysFromStorage();
		}
	});

	App.subscribeEvent('ContactsWebclient::deleteContactsResponse', aParams => {
		let
			responseResult = aParams[0]
		;
		if (responseResult)
		{
			this.reloadKeysFromStorage();
		}
	});
}

COpenPgp.prototype.oKeyring = null;

COpenPgp.prototype.initKeys = async function ()
{
	await this.oKeyring.load();
	await this.reloadKeysFromStorage();
};

/**
 * @return {Array}
 */
COpenPgp.prototype.getKeys = function ()
{
	return this.keys();
};

/**
 * @return {Array}
 */
COpenPgp.prototype.getPublicKeys = function ()
{
	return _.filter(this.keys(), oKey => {
		return oKey && oKey.isPublic() === true;
	});
};

/**
 * @return {Array}
 */
COpenPgp.prototype.getPrivateKeys = function ()
{
	return _.filter(this.keys(), oKey => {
		return oKey && oKey.isPublic() !== true;
	});
};

/**
 * @return {mixed}
 */
COpenPgp.prototype.getKeysObservable = function ()
{
	return this.keys;
};

/**
 * @private
 */
COpenPgp.prototype.reloadKeysFromStorage = async function ()
{
	if (App.isUserNormalOrTenant()) {
		const
			keysFromLocalstorage = this.oKeyring.getAllKeys()
					.filter(key => key && key.primaryKey)
					.map(key => new COpenPgpKey(key)),
			keysFromContacts = await getPublicKeysFromContacts()
		;

		this.keys([...keysFromLocalstorage, ...keysFromContacts]);
		this.ownKeyFromTeamContacts(await getOwnPublicKeyFromTeamContacts());
	} else {
		this.keys([]);
	}
};

COpenPgp.prototype.getKeysFromArmors = getKeysFromArmors;

/**
 * @private
 * @param {Array} aKeys
 * @return {Array}
 */
COpenPgp.prototype.convertToNativeKeys = function (aKeys)
{
	return _.map(aKeys, oItem => {
		return (oItem && oItem.pgpKey) ? oItem.pgpKey : oItem;
	});
};

/**
 * @private
 * @param {Object} oKey
 */
COpenPgp.prototype.cloneKey = async function (oKey)
{
	let oPrivateKey = null;
	if (oKey)
	{
		oPrivateKey = await openpgp.key.readArmored(oKey.armor());
		if (oPrivateKey && !oPrivateKey.err && oPrivateKey.keys && oPrivateKey.keys[0])
		{
			oPrivateKey = oPrivateKey.keys[0];
			if (!oPrivateKey || !oPrivateKey.primaryKey)
			{
				oPrivateKey = null;
			}
		}
		else
		{
			oPrivateKey = null;
		}
	}

	return oPrivateKey;
};

/**
 * @private
 * @param {Object} oResult
 * @param {Object} oKey
 * @param {string} sPassword
 * @param {string} sKeyEmail
 */
COpenPgp.prototype.decryptKeyHelper = async function (oResult, oKey, sPassword, sKeyEmail)
{
	if (oKey && oKey.primaryKey && oKey.primaryKey.isDecrypted() && sPassword === '')
	{
		//key is encoded with an empty password
	}
	else if(oKey)
	{
		try
		{
			await oKey.decrypt(Types.pString(sPassword));
			if (!oKey || !oKey.primaryKey || !oKey.primaryKey.isDecrypted())
			{
				oResult.addError(Enums.OpenPgpErrors.KeyIsNotDecodedError, sKeyEmail || '');
			}
		}
		catch (e)
		{
			oResult.addExceptionMessage(e, Enums.OpenPgpErrors.KeyIsNotDecodedError, sKeyEmail || '');
		}
	}
	else
	{
		oResult.addError(Enums.OpenPgpErrors.KeyIsNotDecodedError, sKeyEmail || '');
	}
};

/**
 * @private
 * @param {Object} oResult
 * @param {string} sFromEmail
 * @param {Object} oDecryptedMessage
 */
COpenPgp.prototype.verifyMessageHelper = async function (oResult, sFromEmail, oDecryptedMessage)
{
	let
		bResult = false,
		oValidKey = null,
		aVerifyResult = [],
		aVerifyKeysId = [],
		aPublicKeys = []
	;

	if (oDecryptedMessage && oDecryptedMessage.getSigningKeyIds)
	{
		aVerifyKeysId = oDecryptedMessage.getSigningKeyIds();
		if (aVerifyKeysId && 0 < aVerifyKeysId.length)
		{
			aPublicKeys = this.findKeysByEmails([sFromEmail], true);
			if (!aPublicKeys || 0 === aPublicKeys.length)
			{
				oResult.addNotice(Enums.OpenPgpErrors.PublicKeyNotFoundNotice, sFromEmail);
			}
			else
			{
				aVerifyResult = [];
				try
				{
					aVerifyResult = await oDecryptedMessage.verify(this.convertToNativeKeys(aPublicKeys));
				}
				catch (e)
				{
					oResult.addNotice(Enums.OpenPgpErrors.VerifyErrorNotice, sFromEmail);
				}

				if (aVerifyResult && 0 < aVerifyResult.length)
				{
					let aValidityPromises = [];
					for (let oKey of aVerifyResult)
					{
						aValidityPromises.push(
							oKey.verified
							.then(validity => {
								return oKey && oKey.keyid && validity ? oKey : null
							})
						);
					}
					await Promise.all(aValidityPromises)
					.then(aKeys => {
						oValidKey = _.find(aKeys, oKey => {
							return oKey !== null;
						});
						if (oValidKey && oValidKey.keyid &&
							aPublicKeys && aPublicKeys[0] &&
							aPublicKeys[0].hasId(oValidKey.keyid.toHex()))
						{
							bResult = true;
						}
						else
						{
							oResult.addNotice(Enums.OpenPgpErrors.VerifyErrorNotice, sFromEmail);
						}
					});
				}
			}
		}
		else
		{
			oResult.addNotice(Enums.OpenPgpErrors.NoSignDataNotice);
		}
	}
	else
	{
		oResult.addError(Enums.OpenPgpErrors.UnknownError);
	}

	if (!bResult && !oResult.hasNotices())
	{
		oResult.addNotice(Enums.OpenPgpErrors.VerifyErrorNotice);
	}

	return bResult;
};

/**
 * @param {string} sUserID
 * @param {string} sPassword
 * @param {number} nKeyLength
 * @param {Function} fOkHandler
 * @param {Function} fErrorHandler
 *
 * @return {COpenPgpResult}
 */
COpenPgp.prototype.generateKey = function (sUserID, sPassword, nKeyLength, fOkHandler, fErrorHandler)
{
	let
		oEmailParts = AddressUtils.getEmailParts(sUserID),
		oOptions = {
			userIds: [{ name: oEmailParts.name, email: oEmailParts.email }],
			numBits: nKeyLength,
			passphrase: sPassword
		}
	;

	openpgp.generateKey(oOptions).then(async oKeyPair => {
			await this.oKeyring.privateKeys.importKey(oKeyPair.privateKeyArmored);
			await this.oKeyring.publicKeys.importKey(oKeyPair.publicKeyArmored);
			await this.oKeyring.store();
			if (_.isFunction(fOkHandler))
			{
				fOkHandler();
			}
			this.reloadKeysFromStorage();
		},
		err => {
			if (_.isFunction(fErrorHandler))
			{
				fErrorHandler();
			}
		}
	);
};

/**
 * @private
 * @param {string} sArmor
 * @return {Array}
 */
COpenPgp.prototype.splitKeys = function (sArmor)
{
	let
		aResult = [],
		iCount = 0,
		iLimit = 30,
		aMatch = null,
		sKey = $.trim(sArmor),
		oReg = /[\-]{3,6}BEGIN[\s]PGP[\s](PRIVATE|PUBLIC)[\s]KEY[\s]BLOCK[\-]{3,6}[\s\S]+?[\-]{3,6}END[\s]PGP[\s](PRIVATE|PUBLIC)[\s]KEY[\s]BLOCK[\-]{3,6}/gi
	;

//	If the key doesn't have any additional fields (for example "Version: 1.1"), this transformation corrupts the key.
//	Seems like it is unnecessary transformation. Everything works fine without it.
//	sKey = sKey.replace(/[\r\n]([a-zA-Z0-9]{2,}:[^\r\n]+)[\r\n]+([a-zA-Z0-9\/\\+=]{10,})/g, '\n$1---xyx---$2')
//		.replace(/[\n\r]+/g, '\n').replace(/---xyx---/g, '\n\n');

	do
	{
		aMatch = oReg.exec(sKey);
		if (!aMatch || 0 > iLimit)
		{
			break;
		}

		if (aMatch[0] && aMatch[1] && aMatch[2] && aMatch[1] === aMatch[2])
		{
			if ('PRIVATE' === aMatch[1] || 'PUBLIC' === aMatch[1])
			{
				aResult.push([aMatch[1], aMatch[0]]);
				iCount++;
			}
		}

		iLimit--;
	}
	while (true);

	return aResult;
};

COpenPgp.prototype.isOwnEmail = function (sEmail)
{
	if (sEmail === App.getUserPublicId())
	{
		return true;
	}
	let
		ModulesManager = require('%PathToCoreWebclientModule%/js/ModulesManager.js'),
		aOwnEmails = ModulesManager.run('MailWebclient', 'getAllAccountsFullEmails') || []
	;
	return (_.find(aOwnEmails, sOwnEmail => {
		let oEmailParts = AddressUtils.getEmailParts(sOwnEmail);
		return sEmail === oEmailParts.email;
	}) !== undefined) ? true : false;
};

/**
 * Imports keys only to personal contatcs.
 * @param {string} armor
 * @param {string} contactUUID
 * @param {boolean} isOwnContact
 * @return {COpenPgpResult}
 */
COpenPgp.prototype.addKeyToContact = async function (armor, contactUUID = '', isOwnContact = false)
{
	armor = $.trim(armor);
	const importResult = new COpenPgpResult();
	if (!armor) {
		return importResult.addError(Enums.OpenPgpErrors.InvalidArgumentErrors);
	}

	let
		armorsData = this.splitKeys(armor),
		armorData = armorsData.length === 1 ? armorsData[0] : null
	;

	if (Array.isArray(armorData) && armorData.length === 2 && 'PUBLIC' === armorData[0]) {
		const armorData = armorsData[0];
		const publicKey = await openpgp.key.readArmored(armorData[1]);
		if (publicKey && !publicKey.err && publicKey.keys && publicKey.keys[0]) {
			if (contactUUID) {
				if (!(await updateContactPublicKey(armorData[1], contactUUID))) {
					importResult.addError(Enums.OpenPgpErrors.ImportKeyError);
				}
				this.reloadKeysFromStorage();
			} else if (isOwnContact) {
				if (!(await updateOwnContactPublicKey(armorData[1]))) {
					importResult.addError(Enums.OpenPgpErrors.ImportKeyError);
				}
				this.reloadKeysFromStorage();
			}
		}
	}

	return importResult;
};

/**
 * @param {string} armorsText
 * @return {COpenPgpResult}
 */
COpenPgp.prototype.importKeys = async function (armorsText)
{
	armorsText = $.trim(armorsText);
	const importResult = new COpenPgpResult();
	if (!armorsText) {
		return importResult.addError(Enums.OpenPgpErrors.InvalidArgumentErrors);
	}

	let
		importedToLocalstorageCount = 0,
		importedToContactsCount = 0,
		armorsData = this.splitKeys(armorsText),
		externalKeys = []
	;

	for (let index = 0; index < armorsData.length; index++) {
		const armorData = armorsData[index];
		if ('PRIVATE' === armorData[0]) {
			try {
				await this.oKeyring.privateKeys.importKey(armorData[1]);
				importedToLocalstorageCount++;
			} catch (error) {
				importResult.addExceptionMessage(error, Enums.OpenPgpErrors.ImportKeyError, 'private');
			}
		} else if ('PUBLIC' === armorData[0]) {
			const publicKey = await openpgp.key.readArmored(armorData[1]);
			if (publicKey && !publicKey.err && publicKey.keys && publicKey.keys[0]) {
				const
					openPgpKey = new COpenPgpKey(publicKey.keys[0]),
					keyEmail = openPgpKey.getEmail()
				;
				if (this.isOwnEmail(keyEmail)) {
					try {
						await this.oKeyring.publicKeys.importKey(armorData[1]);
						importedToLocalstorageCount++;
					} catch (error) {
						importResult.addExceptionMessage(error, Enums.OpenPgpErrors.ImportKeyError, 'public');
					}
				} else {
					externalKeys.push(openPgpKey);
					importedToContactsCount++;
				}
			}
		}
	}

	if ((importedToLocalstorageCount + importedToContactsCount) === 0) {
		importResult.addError(Enums.OpenPgpErrors.ImportNoKeysFoundError);
	}

	if (importedToLocalstorageCount > 0) {
		await this.oKeyring.store();
	}

	if (externalKeys.length > 0) {
		if (await importExternalKeys(externalKeys)) {
			this.reloadKeysFromStorage();
		}
	} else {
		this.reloadKeysFromStorage();
	}

	return importResult;
};

/**
 * @param {string} sArmor
 * @return {Array|boolean}
 */
COpenPgp.prototype.getArmorInfo = async function (sArmor)
{
	sArmor = $.trim(sArmor);

	let
		iIndex = 0,
		iCount = 0,
		oKey = null,
		aResult = [],
		aData = null,
		aKeys = []
	;

	if (!sArmor)
	{
		return false;
	}

	aKeys = this.splitKeys(sArmor);

	for (iIndex = 0; iIndex < aKeys.length; iIndex++)
	{
		aData = aKeys[iIndex];
		if ('PRIVATE' === aData[0])
		{
			try
			{
				oKey = await openpgp.key.readArmored(aData[1]);
				if (oKey && !oKey.err && oKey.keys && oKey.keys[0])
				{
					aResult.push(new COpenPgpKey(oKey.keys[0]));
				}

				iCount++;
			}
			catch (e) {}
		}
		else if ('PUBLIC' === aData[0])
		{
			try
			{
				oKey = await openpgp.key.readArmored(aData[1]);
				if (oKey && !oKey.err && oKey.keys && oKey.keys[0])
				{
					aResult.push(new COpenPgpKey(oKey.keys[0]));
				}

				iCount++;
			}
			catch (e) {}
		}
	}

	return aResult;
};

/**
 * @param {string} sID
 * @param {boolean} bPublic
 * @return {COpenPgpKey|null}
 */
COpenPgp.prototype.findKeyByID = function (sID, bPublic)
{
	bPublic = !!bPublic;
	sID = sID.toLowerCase();

	let oKey = _.find(this.keys(), oKey => {
		return bPublic === oKey.isPublic() && oKey.hasId(sID);
	});
	
	return oKey ? oKey : null;
};

/**
 * @param {array} emails
 * @param {boolean} isPublicKey
 * @param {COpenPgpResult=} findKeysResult
 * @return {array}
 */
COpenPgp.prototype.findKeysByEmails = function (emails, isPublicKey = true, findKeysResult = null)
{
	const openPgpKeys = this.keys().filter(key => {
		return key && isPublicKey === key.isPublic() && emails.includes(key.getEmail());
	});
	if (findKeysResult) {
		const
			emailsFromKeys = openPgpKeys.map(key => key.getEmail()),
			diffEmails = emails.filter(email => !emailsFromKeys.includes(email))
		;
		diffEmails.forEach(email => {
			const errorCode = isPublicKey
					? Enums.OpenPgpErrors.PublicKeyNotFoundError
					: Enums.OpenPgpErrors.PrivateKeyNotFoundError;
			findKeysResult.addError(errorCode, email);
		});
	}
	return openPgpKeys;
};

/**
 * @param {string} email
 * @returns {array}
 */
COpenPgp.prototype.getPublicKeysIfExistsByEmail = function (email)
{
	const publicKeys = this.findKeysByEmails([email], true);
	return publicKeys.length > 1 ? [publicKeys[0]] : publicKeys;
};

/**
 * @param {object} oKey
 * @param {string} sPrivateKeyPassword
 * @returns {object}
 */
COpenPgp.prototype.verifyKeyPassword = async function (oKey, sPrivateKeyPassword)
{
	let
		oResult = new COpenPgpResult(),
		oPrivateKey = this.convertToNativeKeys([oKey])[0],
		oPrivateKeyClone = await this.cloneKey(oPrivateKey)
	;

	await this.decryptKeyHelper(oResult, oPrivateKeyClone, sPrivateKeyPassword, '');
	if (
		!oResult.hasErrors()
		&& !oKey.getPassphrase()
		&& Settings.rememberPassphrase()
	)
	{
		oKey.setPassphrase(sPrivateKeyPassword);
	}

	return oResult;
};

/**
 * @param {string} sData
 * @param {object} oEncryptionKey
 * @param {string} sFromEmail
 * @param {string} sPrivateKeyPassword = ''
 * @param {Function} fOkHandler
 * @param {Function} fErrorHandler
 * @return {string}
 */
COpenPgp.prototype.decryptAndVerify = async function (sData, oEncryptionKey, sFromEmail, sPrivateKeyPassword, fOkHandler, fErrorHandler)
{
	let
		oResult = new COpenPgpResult(),
		aPublicKeys = this.getPublicKeysIfExistsByEmail(sFromEmail)
	;

	try
	{
		const oDecryptionResult = await this.decryptData(
			sData,
			sPrivateKeyPassword,
			false, //bPasswordBasedEncryption
			[oEncryptionKey],
			aPublicKeys
		);

		if (oDecryptionResult.result && _.isFunction(fOkHandler))
		{
			fOkHandler(oDecryptionResult);
		}
		else if (_.isFunction(fErrorHandler))
		{
			fErrorHandler(oDecryptionResult);
		}
	}
	catch (e)
	{
		oResult.addExceptionMessage(e, Enums.OpenPgpErrors.VerifyAndDecryptError);
		if (_.isFunction(fErrorHandler))
		{
			fErrorHandler(oResult);
		}
	}
};

/**
 * @param {string} sData
 * @param {string} sFromEmail
 * @param {Function} fOkHandler
 * @param {Function} fErrorHandler
 * @return {string}
 */
COpenPgp.prototype.verify = async function (sData, sFromEmail, fOkHandler, fErrorHandler)
{
	let
		oMessage = await openpgp.cleartext.readArmored(sData),
		oResult = new COpenPgpResult(),
		aPublicKeys = this.findKeysByEmails([sFromEmail], true, oResult),
		oOptions = {
			message: oMessage,
			publicKeys: this.convertToNativeKeys(aPublicKeys) // for verification
		}
	;

	openpgp.verify(oOptions).then(_.bind(async function(oPgpResult) {
		let aValidityPromises = [];
		let aValidSignatures = [];
		for (let oSignature of oPgpResult.signatures)
		{
			aValidityPromises.push(
				oSignature.verified
				.then(validity => {
					return oSignature && validity === true ? oSignature : null
				})
			);
		}
		await Promise.all(aValidityPromises)
		.then(aSignatures => {
			aValidSignatures = _.filter(aSignatures, function (oSignature) {
				return oSignature !== null;
			});
		});
		if (aValidSignatures.length)
		{
			await this.verifyMessageHelper(oResult, sFromEmail, oMessage);
			oResult.result = oMessage.getText();
			if (oResult.notices && _.isFunction(fErrorHandler))
			{
				fErrorHandler(oResult);
			}
			else if (_.isFunction(fOkHandler))
			{
				fOkHandler(oResult);
			}
		}
		else
		{
			oResult.addError(Enums.OpenPgpErrors.CanNotReadMessage);
			if (_.isFunction(fErrorHandler))
			{
				fErrorHandler(oResult);
			}
		}
	}, this), function (e) {
		oResult.addExceptionMessage(e, Enums.OpenPgpErrors.CanNotReadMessage);
		if (_.isFunction(fErrorHandler))
		{
			fErrorHandler(oResult);
		}
	});
};

COpenPgp.prototype.getPublicKeysByContactsAndEmails = async function (contactUUIDs, emails)
{
	return new Promise((resolve, reject) => {
		const
			parameters = {
				ContactUUIDs: contactUUIDs
			},
			responseHandler = async response => {
				const
					publicKeysArmorsFromContacts = Array.isArray(response.Result) ? response.Result : [],
					publicKeysFromContacts = await getKeysFromArmors(publicKeysArmorsFromContacts),
					publicKeysFromContactsEmails = publicKeysFromContacts.map(publicKey => publicKey.emailParts.email),
					notFoundPrincipalsEmails = emails.filter(email => !publicKeysFromContactsEmails.includes(email)),
					publicKeysFromLocalStorage = this.findKeysByEmails(notFoundPrincipalsEmails),
					allPublicKeys = publicKeysFromContacts.concat(publicKeysFromLocalStorage)
				;
				resolve(allPublicKeys);
			}
		;
		Ajax.send('OpenPgpWebclient', 'GetPublicKeysByCountactUUIDs', parameters, responseHandler);
	});
};

/**
 * @param {string} dataToEncrypt
 * @param {array} principalsEmails
 * @param {function} successCallback
 * @param {function} errorCallback
 * @param {array} contactsUUIDs
 * @return {string}
 */
COpenPgp.prototype.encrypt = async function (dataToEncrypt, principalsEmails, successCallback,
		errorCallback, contactsUUIDs = [])
{
	const
		findKeysResult = new COpenPgpResult(),
		allPublicKeys = await this.getPublicKeysByContactsAndEmails(contactsUUIDs, principalsEmails)
	;

	if (findKeysResult.hasErrors()) {
		if (_.isFunction(errorCallback)) {
			errorCallback(findKeysResult);
		}
		return;
	}

	try {
		const oEncryptionResult = await this.encryptData(dataToEncrypt, allPublicKeys);
		if (oEncryptionResult.result) {
			const { data, password } = oEncryptionResult.result;
			oEncryptionResult.result = data;
			if (_.isFunction(successCallback)) {
				successCallback(oEncryptionResult);
			}
		} else if (_.isFunction(errorCallback)) {
			errorCallback(oEncryptionResult);
		}
	} catch (e) {
		findKeysResult.addExceptionMessage(e, Enums.OpenPgpErrors.EncryptError);
		if (_.isFunction(errorCallback)) {
			errorCallback(findKeysResult);
		}
	}
};

/**
 * @param {string} dataToSign
 * @param {string} fromEmail
 * @param {function} successCallback
 * @param {function} errorCallback
 * @param {string} passphrase
 * @return {string}
 */
COpenPgp.prototype.sign = async function (dataToSign, fromEmail, successCallback, errorCallback,
		passphrase = '')
{
	const
		findKeysResult = new COpenPgpResult(),
		aPrivateKeys = this.findKeysByEmails([fromEmail], false, findKeysResult)
	;

	if (findKeysResult.hasErrors()) {
		if (_.isFunction(errorCallback)) {
			errorCallback(findKeysResult);
		}
		return;
	}

	const
		privateKey = this.convertToNativeKeys(aPrivateKeys)[0],
		privateKeyClone = await this.cloneKey(privateKey)
	;

	if (passphrase === '') {
		passphrase = await this.askForKeyPassword(aPrivateKeys[0].getUser());
		if (passphrase === false) {
			// returning userCanceled status so that error message won't be shown
			findKeysResult.userCanceled = true;
			return findKeysResult;
		} else {
			// returning passphrase so that it won't be asked again until current action popup is closed
			findKeysResult.passphrase = passphrase;
		}
	}

	await this.decryptKeyHelper(findKeysResult, privateKeyClone, passphrase, fromEmail);

	if (privateKeyClone && !findKeysResult.hasErrors()) {
		let oOptions = {
			message: openpgp.cleartext.fromText(dataToSign),
			privateKeys: privateKeyClone
		};
		openpgp.sign(oOptions).then(
			signResult => {
				findKeysResult.result = signResult.data;
				if (_.isFunction(successCallback)) {
					successCallback(findKeysResult);
				}
			},
			error => {
				findKeysResult.addExceptionMessage(error, Enums.OpenPgpErrors.SignError, fromEmail);
				if (_.isFunction(errorCallback)) {
					errorCallback(findKeysResult);
				}
			}
		);
	} else if (_.isFunction(errorCallback)) {
		errorCallback(findKeysResult);
	}
};

/**
 * @param {string} dataToEncrypt
 * @param {string} fromEmail
 * @param {Array} principalsEmails
 * @param {string} passphrase
 * @param {Function} successCallback
 * @param {Function} errorHandler
 * @param {Array} contactsUUIDs
 * @return {string}
 */
COpenPgp.prototype.signAndEncrypt = async function (dataToEncrypt, fromEmail, principalsEmails, passphrase,
		successCallback, errorHandler, contactsUUIDs = [])
{
	const
		findKeysResult = new COpenPgpResult(),
		privateKeys = this.findKeysByEmails([fromEmail], false, findKeysResult),
		allPublicKeys = await this.getPublicKeysByContactsAndEmails(contactsUUIDs, principalsEmails)
	;

	if (findKeysResult.hasErrors()) {
		if (_.isFunction(errorHandler)) {
			errorHandler(findKeysResult);
		}
		return;
	}

	try {
		const
			isPasswordBasedEncryption = false,
			needToSign = true,
			encryptionResult = await this.encryptData(dataToEncrypt, allPublicKeys, privateKeys,
				isPasswordBasedEncryption, needToSign, passphrase
			)
		;
		if (encryptionResult.result) {
			const { data, password } = encryptionResult.result;
			if (_.isFunction(successCallback)) {
				successCallback({result: data});
			}
		} else if (_.isFunction(errorHandler)) {
			errorHandler(encryptionResult);
		}
	} catch (e) {
		findKeysResult.addExceptionMessage(e, Enums.OpenPgpErrors.SignAndEncryptError);
		if (_.isFunction(errorHandler)) {
			errorHandler(findKeysResult);
		}
	}
};

/**
 * @param {blob|string} Data
 * @param {array} aPublicKeys
 * @param {array} aPrivateKeys
 * @param {string} sPrincipalsEmail
 * @param {boolean} bPasswordBasedEncryption
 * @param {boolean} bSign
 * @param {string} sPassphrase
 * @return {COpenPgpResult}
 */
COpenPgp.prototype.encryptData = async function (Data, aPublicKeys = [], aPrivateKeys = [],
	bPasswordBasedEncryption = false, bSign = false, sPassphrase = '')
{
	let
		oResult = new COpenPgpResult(),
		sPassword = '',
		bIsBlob = Data instanceof Blob,
		buffer = null,
		oOptions = {}
	;

	oResult.result = false;
	if (bIsBlob)
	{
		buffer = await new Response(Data).arrayBuffer();
		oOptions.message = openpgp.message.fromBinary(new Uint8Array(buffer));
		oOptions.armor = false;
		Data = null;
		buffer = null;
	}
	else
	{
		oOptions.message = openpgp.message.fromText(Data);
	}

	if (bPasswordBasedEncryption)
	{
		sPassword = this.generatePassword();
		oOptions.passwords = [sPassword];
	}
	else if (Types.isNonEmptyArray(aPublicKeys))
	{
		oOptions.publicKeys = this.convertToNativeKeys(aPublicKeys);
	}

	if (bSign && aPrivateKeys && aPrivateKeys.length > 0)
	{
		let
			oPrivateKey = this.convertToNativeKeys(aPrivateKeys)[0],
			oPrivateKeyClone = await this.cloneKey(oPrivateKey),
			sStoredPassphrase = aPrivateKeys[0].getPassphrase()
		;

		if (sStoredPassphrase && !sPassphrase)
		{
			sPassphrase = sStoredPassphrase;
		}

		if (!sPassphrase)
		{
			sPassphrase = await this.askForKeyPassword(aPrivateKeys[0].getUser());
			if (sPassphrase === false)
			{
				// returning userCanceled status so that error message won't be shown
				oResult.userCanceled = true;
				return oResult;
			}
			else
			{
				// returning passphrase so that it won't be asked again until current action popup is closed
				oResult.passphrase = sPassphrase;
			}
		}
		await this.decryptKeyHelper(oResult, oPrivateKeyClone, sPassphrase, aPrivateKeys[0].getEmail());
		if (
			!oResult.hasErrors()
			&& !sStoredPassphrase
			&& Settings.rememberPassphrase()
		)
		{
			aPrivateKeys[0].setPassphrase(sPassphrase);
		}
		oOptions.privateKeys = [oPrivateKeyClone];
	}
	if (!oResult.hasErrors())
	{
		try
		{
			let oPgpResult = await openpgp.encrypt(oOptions);

			oResult.result = {
				data:		bIsBlob ? oPgpResult.message.packets.write() : oPgpResult.data,
				passphrase: sPassphrase,
				password:	sPassword
			};
		}
		catch (e)
		{
			oResult.addExceptionMessage(e, Enums.OpenPgpErrors.EncryptError);
		}
	}

	return oResult;
};

/**
 * @param {blob|string} Data
 * @param {string} sPassword
 * @param {boolean} bPasswordBasedEncryption
 * @param {array} aPublicKeys
 * @return {string}
 */
COpenPgp.prototype.decryptData = async function (Data, sPassword = '', bPasswordBasedEncryption = false, aPrivateKeys = [], aPublicKeys = [])
{
	let
		oResult = new COpenPgpResult(),
		bIsBlob = Data instanceof Blob,
		buffer = null,
		sEmail = ''
	;

	//if public keys are not defined - use all public keys for verification
	aPublicKeys = Types.isNonEmptyArray(aPublicKeys) ? aPublicKeys : this.getPublicKeys();
	let oOptions = {
		publicKeys: this.convertToNativeKeys(aPublicKeys) // for verification
	};

	if (bIsBlob)
	{
		buffer = await new Response(Data).arrayBuffer();
		oOptions.message = await openpgp.message.read(new Uint8Array(buffer));
		oOptions.format = 'binary';
	}
	else
	{
		oOptions.message = await openpgp.message.readArmored(Data);
	}

	if (!Types.isNonEmptyArray(aPrivateKeys))
	{
		let aKeyIds = oOptions.message.getEncryptionKeyIds().map(oKeyId => oKeyId.toHex());
		aPrivateKeys = aKeyIds
			.map(sKeyId => this.findKeyByID(sKeyId, /*bPublic*/false))
			.filter(oKey => oKey !== null);
	}
	oResult.result = false;

	if (bPasswordBasedEncryption)
	{
		oOptions.passwords = [sPassword];
	}
	else
	{
		if (aPrivateKeys && aPrivateKeys.length > 0)
		{
			let
				oPrivateKey = this.convertToNativeKeys(aPrivateKeys)[0],
				oPrivateKeyClone = await this.cloneKey(oPrivateKey),
				sStoredPassphrase = aPrivateKeys[0].getPassphrase(),
				sPassphrase = sPassword
			;

			if (sStoredPassphrase && !sPassphrase)
			{
				sPassphrase = sStoredPassphrase;
			}

			if (!sPassphrase)
			{
				sPassphrase = await this.askForKeyPassword(aPrivateKeys[0].getUser());
				if (sPassphrase === false)
				{
					// returning userCanceled status so that error message won't be shown
					oResult.userCanceled = true;
					return oResult;
				}
				else
				{
					// returning passphrase so that it won't be asked again until current action popup is closed
					oResult.passphrase = sPassphrase;
				}
			}
			sEmail = aPrivateKeys[0].getEmail();
			await this.decryptKeyHelper(oResult, oPrivateKeyClone, sPassphrase, sEmail);
			if (
				!oResult.hasErrors()
				&& !sStoredPassphrase
				&& Settings.rememberPassphrase()
			)
			{
				aPrivateKeys[0].setPassphrase(sPassphrase);
			}
			oOptions.privateKeys = oPrivateKeyClone;
		}
		else
		{
			oResult.addError(Enums.OpenPgpErrors.PrivateKeyNotFoundError);
			return oResult;
		}
	}

	if (!oResult.hasErrors())
	{
		try
		{
			let oPgpResult = await openpgp.decrypt(oOptions);
			oResult.result = await openpgp.stream.readToEnd(oPgpResult.data);
			//if result contains invalid signatures
			let aValidityPromises = [];
			for (let oSignature of oPgpResult.signatures)
			{
				aValidityPromises.push(
					oSignature.verified
					.then(validity => {
						oSignature.is_valid = validity;
						return oSignature;
					})
				);
			}
			await Promise.all(aValidityPromises)
			.then(aSignatures => {
				const aInvalidSignatures = _.filter(aSignatures, oSignature => {
					return oSignature !== null && oSignature.is_valid !== true;
				});
				const aValidSignatures = _.filter(aSignatures, oSignature => {
					return oSignature !== null && oSignature.is_valid === true;
				});

				if (oPgpResult.signatures.length && aInvalidSignatures.length > 0)
				{
					oResult.addNotice(Enums.OpenPgpErrors.VerifyErrorNotice, sEmail);
				}
				else if (aValidSignatures.length > 0)
				{
					const aKeyNames = _.map(aValidSignatures, oSignature => {
						const sKeyID = oSignature.keyid.toHex();
						const oKey = this.findKeyByID(sKeyID, true);
						return oKey.getUser();
					});
					oResult.validKeyNames = aKeyNames;
				}
			});
		}
		catch (e)
		{
			oResult.addExceptionMessage(e, Enums.OpenPgpErrors.VerifyAndDecryptError);
		}
	}

	return oResult;
};

COpenPgp.prototype.getPrivateKeyPassword = async function (sEmail)
{
	let
		oResult = new COpenPgpResult(),
		aPrivateKeys = this.findKeysByEmails([sEmail], false, oResult)
	;

	if (Types.isNonEmptyArray(aPrivateKeys))
	{
		let
			oPrivateKey = this.convertToNativeKeys(aPrivateKeys)[0],
			oPrivateKeyClone = await this.cloneKey(oPrivateKey),
			sStoredPassphrase = aPrivateKeys[0].getPassphrase(),
			sPassphrase = null
		;

		if (sStoredPassphrase)
		{
			sPassphrase = sStoredPassphrase;
		}

		if (!sPassphrase)
		{
			sPassphrase = await this.askForKeyPassword(aPrivateKeys[0].getUser());
			if (sPassphrase === false)
			{//user cancel operation
				return null;
			}
		}

		await this.decryptKeyHelper(oResult, oPrivateKeyClone, sPassphrase, sEmail);

		if (
			!oResult.hasErrors()
			&& !sStoredPassphrase
			&& Settings.rememberPassphrase()
		)
		{
			aPrivateKeys[0].setPassphrase(sPassphrase);
		}

		if (!oResult.hasErrors())
		{
			return sPassphrase;
		}
	}

	return null;
};

COpenPgp.prototype.askForKeyPassword = async function (sKeyName)
{
	let oPromiseKeyPassword = new Promise( (resolve, reject) => {
		const fOnPasswordEnterCallback = sKeyPassword => {
			resolve(sKeyPassword);
		};
		const fOnCancellCallback = () => {
			resolve(false);
		};
		//showing popup
		Popups.showPopup(PGPKeyPasswordPopup, [
				sKeyName,
				fOnPasswordEnterCallback,
				fOnCancellCallback
		]);
	});

	let sPassword = await oPromiseKeyPassword;

	return sPassword;
};

/**
 * @param {COpenPgpKey} openPgpKey
 */
COpenPgp.prototype.removeKeyFromContacts = async function (openPgpKey)
{
	const result = new COpenPgpResult();
	if (!openPgpKey) {
		return result.addError(Enums.OpenPgpErrors.InvalidArgumentError);
	}

	if (isTeamContactsAvailable && openPgpKey.emailParts.email === App.getUserPublicId() && !openPgpKey.isPrivate()) {
		if (!(await updateOwnContactPublicKey(''))) {
			result.addError(Enums.OpenPgpErrors.DeleteError);
		}
		this.reloadKeysFromStorage();
	} else {
		const
			parameters = { 'Email': openPgpKey.getEmail() },
			responseHandler = response => {
				if (!response || !response.Result) {
					result.addError(Enums.OpenPgpErrors.DeleteError);
				}
				this.reloadKeysFromStorage();
			}
		;
		Ajax.send('%ModuleName%', 'RemovePublicKeyFromContact', parameters, responseHandler);
	}

	return result;
};

/**
 * @param {COpenPgpKey} openPgpKey
 */
COpenPgp.prototype.removeKeyFromThisDevice = async function (openPgpKey)
{
	const result = new COpenPgpResult();
	if (!openPgpKey) {
		return result.addError(Enums.OpenPgpErrors.InvalidArgumentError);
	}

	try {
		this.oKeyring[openPgpKey.isPrivate() ? 'privateKeys' : 'publicKeys'].removeForId(openPgpKey.getFingerprint());
		await this.oKeyring.store();
		this.reloadKeysFromStorage();
	} catch (e) {
		result.addExceptionMessage(e, Enums.OpenPgpErrors.DeleteError);
	}

	return result;
};

COpenPgp.prototype.getEncryptionKeyFromArmoredMessage = async function (sArmoredMessage)
{
	let oMessage = await openpgp.message.readArmored(sArmoredMessage);
	let aEncryptionKeys = oMessage.getEncryptionKeyIds();
	let oEncryptionKey = null;

	if (aEncryptionKeys.length > 0)
	{
		for (let key of aEncryptionKeys)
		{
			let oKey = this.findKeyByID(key.toHex(), false);
			if (oKey)
			{
				oEncryptionKey = oKey;
				break;
			}
		}
	}

	return oEncryptionKey;
};

COpenPgp.prototype.generatePassword = function ()
{
	let sPassword = "";

	if (window.crypto)
	{
		let password = window.crypto.getRandomValues(new Uint8Array(10));
		sPassword = btoa(String.fromCharCode.apply(null, password));
		sPassword = sPassword.replace(/[^A-Za-z0-9]/g, "");
	}
	else
	{
		const sSymbols = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!;%:?*()_+=";

		for (let i = 0; i < this.iPasswordLength; i++)
		{
			sPassword += sSymbols.charAt(Math.floor(Math.random() * sSymbols.length));
		}
	}

	return sPassword;
};

COpenPgp.prototype.getCurrentUserPrivateKey = async function ()
{
	let mResult = null;
	let sUserEmail = App.getUserPublicId ? App.getUserPublicId() : '';
	let aPrivateKeys = this.findKeysByEmails([sUserEmail], /*bIsPublic*/false);

	if (aPrivateKeys.length < 1)
	{
		const sError = TextUtils.i18n('%MODULENAME%/ERROR_NO_PRIVATE_KEYS_FOR_USERS_PLURAL',
			{'USERS': sUserEmail}, null, 1);
		Screens.showError(sError);
	}
	else
	{
		mResult = aPrivateKeys[0];
	}

	return mResult;
};

COpenPgp.prototype.getCurrentUserPublicKey = async function ()
{
	let mResult = null;
	let sUserEmail = App.getUserPublicId ? App.getUserPublicId() : '';
	let aPrivateKeys = this.findKeysByEmails([sUserEmail], /*bIsPublic*/false);

	if (aPrivateKeys.length > 0)
	{
		let aNativePrivateKeys = this.convertToNativeKeys(aPrivateKeys);
		mResult = aNativePrivateKeys[0].toPublic();
	}
	else
	{
		let aPublicKeys = this.findKeysByEmails([sUserEmail], /*bIsPublic*/true);
		if (aPublicKeys.length > 0)
		{
			mResult = aPublicKeys[0];
		}
	}
	if (!mResult)
	{
		const sError = TextUtils.i18n('%MODULENAME%/ERROR_NO_PUBLIC_KEYS_FOR_USERS_PLURAL',
			{'USERS': sUserEmail}, null, 1);
		Screens.showError(sError);
	}

	return mResult;
};

COpenPgp.prototype.isPrivateKeyAvailable = async function ()
{
	await this.oPromiseInitialised;
	let sUserEmail = App.getUserPublicId ? App.getUserPublicId() : '';
	let aPrivateKeys = this.findKeysByEmails([sUserEmail], /*bIsPublic*/false);

	return !!aPrivateKeys.length;
};

COpenPgp.prototype.showPgpErrorByCode = function (oOpenPgpResult, sPgpAction, sDefaultError)
{
	ErrorsUtils.showPgpErrorByCode(oOpenPgpResult, sPgpAction, sDefaultError);
};

/**
 * @param {string} messageToEncrypt
 * @param {string} aPrincipalsEmail
 * @param {boolean} needToSign
 * @param {string} passphrase
 * @param {string} fromEmail
 * @param {string} contactUUID
 * @return {COpenPgpResult}
 */
COpenPgp.prototype.encryptMessage = async function (messageToEncrypt, principalEmail, needToSign,
		passphrase, fromEmail, contactUUID = '')
{
	const
		publicKeys = await this.getPublicKeysByContactsAndEmails([contactUUID], [principalEmail]),
		privateKeys = this.findKeysByEmails([fromEmail], false),
		isPasswordBasedEncryption = false,
		encryptionResult = await this.encryptData(messageToEncrypt, publicKeys, privateKeys,
			isPasswordBasedEncryption, needToSign, passphrase)
	;

	if (encryptionResult.result) {
		let {data, password} = encryptionResult.result;
		encryptionResult.result = data;
	}

	return encryptionResult;
};

module.exports = new COpenPgp();
