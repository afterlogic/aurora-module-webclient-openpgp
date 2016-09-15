<?php

class OpenPgpWebclientModule extends AApiModule
{
	/***** public functions might be called with web API *****/
	/**
	 * Obtaines list of module settings for authenticated user.
	 * 
	 * @return array
	 */
	public function GetAppData()
	{
		\CApi::checkUserRoleIsAtLeast(\EUserRole::Anonymous);
		
		return array(
			'EnableModule' => true // AppData.User.EnableOpenPgp
		);
	}
	/***** public functions might be called with web API *****/
}
