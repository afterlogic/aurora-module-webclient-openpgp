'use strict';

var
	ko = require('knockout'),
	_ = require('underscore'),

	Types = require('%PathToCoreWebclientModule%/js/utils/Types.js')
;

module.exports = {
	ServerModuleName: '%ModuleName%',
	HashModuleName: 'openpgp',

	enableOpenPgpInMail: ko.observable(false),
	rememberPassphrase: ko.observable(false),

	/**
	 * Initializes settings from AppData object sections.
	 *
	 * @param {Object} oAppData Object contained modules settings.
	 */
	init: function (oAppData)
	{
		var oAppDataSection = oAppData['%ModuleName%'];

		if (!_.isEmpty(oAppDataSection))
		{
			this.enableOpenPgpInMail(Types.pBool(oAppDataSection.EnableModule, this.enableOpenPgpInMail()));
			this.rememberPassphrase(Types.pBool(oAppDataSection.RememberPassphrase, this.rememberPassphrase()));
		}
	},

	/**
	 * Updates new settings values after saving on server.
	 *
	 * @param {boolean} bEnableOpenPgpInMail
	 */
	update: function (bEnableOpenPgpInMail)
	{
		this.enableOpenPgpInMail(bEnableOpenPgpInMail);
	}
};
