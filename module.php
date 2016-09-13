<?php

class OpenPgpWebclientModule extends AApiModule
{
	public function GetAppData()
	{
		\CApi::checkUserRoleIsAtLeast(\EUserRole::Anonymous);
		
		return array(
			'EnableModule' => true // AppData.User.EnableOpenPgp
		);
	}
}
