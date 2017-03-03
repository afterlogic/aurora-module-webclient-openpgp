<?php

namespace Aurora\Modules;

class OpenPgpWebclientModule extends \Aurora\System\Module\AbstractModule
{
	/***** public functions might be called with web API *****/
	/**
	 * Obtains list of module settings for authenticated user.
	 * 
	 * @return array
	 */
	public function GetSettings()
	{
		\Aurora\System\Api::checkUserRoleIsAtLeast(\EUserRole::Anonymous);
		
		return array(
			'EnableModule' => true // AppData.User.EnableOpenPgp
		);
	}
	/***** public functions might be called with web API *****/
}
