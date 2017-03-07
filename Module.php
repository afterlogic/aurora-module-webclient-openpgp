<?php

namespace Aurora\Modules\OpenPgpWebclient;

class Module extends \Aurora\System\Module\AbstractWebclientModule
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
